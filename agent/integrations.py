"""Composio integration loader for the Modal agent.

Dual-path:
- CURATED — pre-loads FunctionTool wrappers for the top-N most-used actions
  per toolkit (see integrations_curated.py). These skip the dispatcher's
  two-hop find→call round trip, killing ~3-5s of perceived latency on the
  common cases (gmail_send_email, googlecalendar_events_list, etc.).
- DISPATCHER — find_integration_tool + call_integration_tool stay as
  fallback for the long tail (any Composio action not in the curated
  allowlist, or whose schema fetch failed at build time).

Total tool count is hard-capped at MAX_TOTAL_TOOLS to stay well under
xAI's 200-tool ceiling. With ~30 native + 4-8 curated × 4 toolkits + 2
dispatcher ≈ 60-70 total in the realistic case. The cap is a guard rail
against a future expansion that forgets the ceiling exists.

Empty list on any failure path (no toolkits connected, proxy not
configured, schema fetch error) — chat must keep working on the native
catalog regardless of Composio's state.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
import structlog

from config import settings
from db import supabase
from integrations_curated import CURATED_ACTIONS, curated_slugs_for

logger = structlog.get_logger()


# Maximum total tools (native + curated + dispatcher) any one chat turn
# can be built with. xAI's hard ceiling is 200; we leave a wide margin so
# adding a few natives or curated entries never silently overflows. If
# this triggers, shrink the curated allowlist before raising the cap.
MAX_TOTAL_TOOLS = 100

# Number of native tools shipped on every Chippi agent. Source of truth
# is chippi.py:make_chippi_agent's base_tools list — bump this constant
# when adding/removing natives so the budget math stays honest.
_NATIVE_TOOL_COUNT = 36

# Composio schema fetch — Vercel proxies through to Composio; one round
# trip per agent build. Same timeout shape as the dispatcher search.
_SCHEMA_FETCH_TIMEOUT = 30.0
# Per-tool execute timeout — must match the dispatcher's _EXEC_TIMEOUT
# so curated and dispatched calls behave the same on slow upstreams.
_EXEC_TIMEOUT = 120.0

# Native tool names that ship on every Chippi agent. Any curated tool
# whose lowercased slug would collide gets a toolkit prefix added
# defensively. The xAI Chat Completions endpoint rejects the entire
# request with `Duplicate function definition` when two functions share
# a name — OpenAI / Anthropic silently dedup but Grok is strict. The
# user-visible symptom is a chat that says "integrations connected"
# then fails on the next turn with a 400 from the model provider.
#
# Keep this in sync with chippi.py:make_chippi_agent's base_tools list.
_NATIVE_TOOL_NAMES = frozenset({
    "create_contact", "find_contacts", "get_contact_activity", "update_contact",
    "create_deal", "find_deals", "update_deal", "advance_deal_stage",
    "request_deal_review",
    "book_tour", "route_lead", "add_property", "send_property_packet",
    "recall_memory", "store_memory", "manage_goal", "manage_routines",
    "draft_message", "send_email_now", "send_sms_now",
    "outcome", "analyze_portfolio", "generate_priority_list",
    "process_inbound_message", "read_attachment", "ask_realtor",
    "log_activity_run", "recall_docs", "create_plan",
    "get_intake_form", "add_intake_question", "remove_intake_question",
    "update_intake_question", "save_intake_form",
    "generate_studio_image", "edit_studio_image",
    # Dispatcher tools — curated must never collide with these either.
    "find_integration_tool", "call_integration_tool",
})


async def active_toolkits(space_id: str, user_id: str) -> list[str]:
    """Toolkit slugs the realtor has connected and our DB has marked active.

    Returned in deterministic alphabetical order — stable across turns so
    the agent's tool list (which derives from this) keeps a stable prefix
    for prompt caching. Without an order clause Supabase's natural row order
    can shuffle between requests and silently miss the provider cache.
    """
    db = await supabase()
    res = await (
        db.table("IntegrationConnection")
        .select("toolkit")
        .eq("spaceId", space_id)
        .eq("userId", user_id)
        .eq("status", "active")
        .order("toolkit")
        .execute()
    )
    rows = res.data or []
    return [r["toolkit"] for r in rows if r.get("toolkit")]


def _proxy_base() -> tuple[str, str] | None:
    """The (base_url, secret) pair the agent uses to call Vercel internally.

    Returns None if the proxy is unconfigured or pointed at a local URL —
    a localhost base would be a deploy misconfig, not something to send
    integration calls to.
    """
    base_url = (settings.app_url or "").rstrip("/")
    secret = settings.agent_internal_secret
    if not base_url or not secret:
        return None
    if "localhost" in base_url or "127.0.0.1" in base_url:
        return None
    return base_url, secret


def _safe_tool_name(slug: str, toolkit: str) -> str:
    """Build a unique-per-process function name from a Composio slug.

    Composio slugs are uppercase + underscore (`GMAIL_SEND_EMAIL`,
    `HUBSPOT_CRM_CREATE_CONTACT`). Lowercasing usually keeps them unique
    against our native tools — but a Composio slug like `CREATE_CONTACT`
    on its own would collide with our native `create_contact` tool.
    The xAI Chat Completions API refuses any request whose function list
    has duplicate names; OpenAI/Anthropic dedup silently which is worse
    (calling the wrong tool entirely). Defensively prefix with the
    toolkit slug whenever the base would collide.
    """
    raw = (slug or "").lower()
    cleaned = "".join(c if c.isalnum() or c == "_" else "_" for c in raw)
    tk = (toolkit or "").lower().strip("_")
    if cleaned in _NATIVE_TOOL_NAMES and tk and not cleaned.startswith(f"{tk}_"):
        cleaned = f"{tk}_{cleaned}"
    if not cleaned:
        cleaned = f"{tk}_unnamed" if tk else "unnamed_tool"
    return cleaned[:64]


async def _fetch_curated_schemas(
    *,
    space_id: str,
    user_id: str,
    slugs: list[str],
    base_url: str,
    secret: str,
) -> list[dict[str, Any]]:
    """Fetch JSON schemas for the requested slugs via the search endpoint's
    exact-slug filter path. Returns [] on any failure — the caller treats
    that as "fall back to dispatcher for these toolkits".

    One HTTP round trip per agent build, regardless of how many slugs.
    The endpoint enforces "slug's toolkit must be active for this user",
    so a stale curated entry for an unconnected toolkit returns nothing.
    """
    if not slugs:
        return []
    try:
        async with httpx.AsyncClient(timeout=_SCHEMA_FETCH_TIMEOUT) as client:
            resp = await client.post(
                f"{base_url}/api/internal/integrations/search",
                json={
                    "spaceId": space_id,
                    "userId": user_id,
                    "slugs": slugs,
                },
                headers={"Authorization": f"Bearer {secret}"},
            )
    except Exception as err:  # noqa: BLE001
        logger.warning(
            "curated_schema_fetch_failed",
            space_id=space_id,
            user_id=user_id,
            slug_count=len(slugs),
            error=str(err)[:300],
        )
        return []
    if resp.status_code >= 400:
        logger.warning(
            "curated_schema_fetch_bad_status",
            space_id=space_id,
            user_id=user_id,
            status=resp.status_code,
        )
        return []
    try:
        data = resp.json()
    except Exception:
        return []
    return data.get("tools") or []


def _sanitize_enums_for_xai(node: Any) -> Any:
    """Strip JSON Schema enums whose string values contain xAI-rejected chars.

    xAI's Chat Completions schema validator currently refuses `/` inside
    enum string values:

      Error code: 400 - Schema validation failed: [engine_imposed]
        /properties/hs_legal_basis/enum/0: '/' in 'enum' string value
        is currently not supported

    HubSpot ships canonical values like `Performance / Contract` for
    fields like `hs_legal_basis`; Composio surfaces those verbatim and
    xAI then refuses the entire chat turn before the model sees anything.
    OpenAI / Anthropic accept them — this is a Grok-specific quirk.

    The cleanest fix is to drop the offending enum constraint and append
    the valid values to the field's `description`, so the model still
    knows what to send and the upstream API (HubSpot) revalidates with
    the canonical strings intact. Recurses into properties, items, the
    composite keywords (anyOf/oneOf/allOf), and $defs so nested schemas
    are covered.
    """
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            if k in ("properties", "patternProperties", "$defs", "definitions") and isinstance(v, dict):
                out[k] = {sub_k: _sanitize_enums_for_xai(sub_v) for sub_k, sub_v in v.items()}
            elif k in ("items", "additionalProperties", "not", "if", "then", "else"):
                out[k] = _sanitize_enums_for_xai(v)
            elif k in ("anyOf", "oneOf", "allOf") and isinstance(v, list):
                out[k] = [_sanitize_enums_for_xai(item) for item in v]
            else:
                out[k] = v
        # Decide on THIS node's enum after recursion so children are clean.
        enum_val = out.get("enum")
        if isinstance(enum_val, list) and any(
            isinstance(e, str) and "/" in e for e in enum_val
        ):
            valid = ", ".join(str(e) for e in enum_val)
            desc = str(out.get("description", "") or "")
            sep = " " if desc and not desc.endswith(" ") else ""
            out["description"] = f"{desc}{sep}Valid values: {valid}".strip()
            del out["enum"]
        return out
    if isinstance(node, list):
        return [_sanitize_enums_for_xai(item) for item in node]
    return node


def _build_curated_tool(
    *,
    slug: str,
    name: str,
    description: str,
    parameters: dict[str, Any],
    toolkit: str,
    space_id: str,
    user_id: str,
    base_url: str,
    secret: str,
) -> Any:
    """Wrap one Composio action as a FunctionTool whose handler POSTs to
    /api/internal/integrations/execute — the same path the dispatcher's
    call_integration_tool uses, just bound to a known slug at build time
    instead of looked up via search at call time.

    The execute proxy is the only file that knows how to talk to Composio
    (auth, version-skip, error envelope shape). Curated tools deliberately
    go through it instead of calling Composio directly from Modal — so
    runtime behavior, error shapes, and the realtor's `IntegrationConnection`
    side-effects stay identical between the curated and dispatcher paths.
    """
    try:
        from agents import FunctionTool
    except ImportError:
        from agents.tool import FunctionTool  # older SDK path

    async def on_invoke(ctx: Any, args_json: str) -> str:
        try:
            arguments = json.loads(args_json) if args_json else {}
        except Exception as err:
            return json.dumps({"ok": False, "error": f"bad arguments: {err}"})
        logger.info(
            "curated_call_invoked",
            space_id=space_id,
            toolkit=toolkit,
            slug=slug,
            tool_name=name,
            arg_keys=list(arguments.keys()) if isinstance(arguments, dict) else [],
        )
        try:
            async with httpx.AsyncClient(timeout=_EXEC_TIMEOUT) as client:
                resp = await client.post(
                    f"{base_url}/api/internal/integrations/execute",
                    json={
                        "spaceId": space_id,
                        "userId": user_id,
                        "slug": slug,
                        "arguments": arguments,
                    },
                    headers={"Authorization": f"Bearer {secret}"},
                )
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "curated_call_request_failed",
                space_id=space_id,
                toolkit=toolkit,
                slug=slug,
                error=str(err)[:300],
            )
            return json.dumps({"ok": False, "error": f"{slug} request failed: {err}"})

        body_text = resp.text
        if resp.status_code >= 500:
            return body_text or json.dumps(
                {"ok": False, "error": f"{slug} failed ({resp.status_code})"}
            )
        # 4xx body carries the Composio envelope (possibleFixes, requestId)
        # the model uses to self-correct. 2xx already carries {ok,data,error}.
        return body_text or json.dumps({"ok": True, "data": None})

    # `additionalProperties: True` matches the TS side (lib/integrations/
    # agent-tools.ts) — Composio re-validates server-side anyway, so loose
    # client schemas are safe and avoid spurious validation errors when
    # the model wants to pass a parameter the schema doesn't enumerate.
    # Run xAI-enum sanitization on the properties before assembling, so any
    # HubSpot-style `Performance / Contract` enums get demoted to
    # description hints and don't crash the chat turn at the provider.
    raw_properties = (parameters or {}).get("properties", {}) or {}
    sanitized_properties = {
        k: _sanitize_enums_for_xai(v) for k, v in raw_properties.items()
    }
    safe_parameters: dict[str, Any] = {
        "type": "object",
        "properties": sanitized_properties,
        "required": (parameters or {}).get("required", []) or [],
        "additionalProperties": True,
    }

    return FunctionTool(
        name=name,
        description=description,
        params_json_schema=safe_parameters,
        on_invoke_tool=on_invoke,
        strict_json_schema=False,
    )


def _dispatcher_pair() -> list[Any]:
    from tools.integrations_dispatcher import (
        call_integration_tool,
        find_integration_tool,
    )

    return [find_integration_tool, call_integration_tool]


async def load_integration_tools(
    space_id: str,
    user_id: str,
    toolkits: list[str] | None = None,
) -> list[Any]:
    """Return curated FunctionTools (one per top-N action on each connected
    toolkit) PLUS the dispatcher fallback (find_integration_tool +
    call_integration_tool). Empty list ONLY when no toolkits are connected
    — chat must keep working on the native catalog regardless.

    Pass `toolkits` when the caller already fetched the connected list
    (chat_turn does, for workspace_info) — saves a duplicate DB query on
    the hot path.

    Degradation policy: when the proxy env is missing or the connected
    lookup fails, return the DISPATCHER PAIR rather than nothing. The
    dispatcher fails loudly and instructively at call time ("integration
    proxy not configured — tell the realtor…"), which the model can relay
    as "temporarily unavailable". Returning [] here made every config
    failure indistinguishable from "the realtor connected nothing", and
    the model told realtors their integrations were gone.
    """
    proxy = _proxy_base()
    if proxy is None:
        logger.error(
            "integration_proxy_not_configured",
            space_id=space_id,
            user_id=user_id,
            hint="set NEXT_PUBLIC_APP_URL and AGENT_INTERNAL_SECRET in the Modal secret",
        )
        return _dispatcher_pair()
    base_url, secret = proxy

    if toolkits is None:
        try:
            toolkits = await active_toolkits(space_id, user_id)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "integration_active_check_failed",
                space_id=space_id,
                user_id=user_id,
                error=str(err)[:200],
            )
            # Unknown whether connections exist — hand the model the
            # dispatcher so a transient DB blip can't zero out tools.
            return _dispatcher_pair()
    if not toolkits:
        return []

    # ── Curated per-toolkit tools: ON by default ────────────────────────────
    # History: curated was DISABLED by default as a token guard (each curated
    # schema is 1-3k tokens, re-sent every agent-loop step). But the
    # dispatcher-only default meant a realtor's connected Gmail surfaced as
    # two generic search tools while the prompt told the model gmail_* tools
    # were pre-loaded — the model concluded it had no Gmail and SAID SO. The
    # most-reported integration bug was this default. Tokens are managed by
    # the curated-slug budget below (MAX_TOTAL_TOOLS cap), not by hiding the
    # tools. Opt OUT with CHIPPI_CURATED_INTEGRATIONS=0 if a deploy must.
    curated_enabled = (
        os.environ.get("CHIPPI_CURATED_INTEGRATIONS", "1") or "1"
    ).strip().lower() not in ("0", "false", "no", "off")
    if not curated_enabled:
        logger.info(
            "integration_tools_dispatcher_only",
            space_id=space_id,
            user_id=user_id,
            connected_toolkits=toolkits,
            reason="curated_disabled_by_env",
        )
        return _dispatcher_pair()

    # Collect curated slugs across the realtor's connected toolkits. A
    # toolkit with no curated entry contributes nothing here and falls
    # back to dispatcher-only — intentional, not a bug.
    slug_to_toolkit: dict[str, str] = {}
    flat_slugs: list[str] = []
    for tk in toolkits:
        for slug in curated_slugs_for(tk):
            if slug not in slug_to_toolkit:
                slug_to_toolkit[slug] = tk
                flat_slugs.append(slug)

    # Per-call budget — keeps the curated set strictly under the cap, even
    # if a future allowlist grows past it. Native + dispatcher (2) reserve
    # their slots first.
    budget = MAX_TOTAL_TOOLS - _NATIVE_TOOL_COUNT - 2
    if budget < 0:
        budget = 0
    if len(flat_slugs) > budget:
        logger.warning(
            "curated_slugs_truncated_to_budget",
            requested=len(flat_slugs),
            budget=budget,
            cap=MAX_TOTAL_TOOLS,
        )
        flat_slugs = flat_slugs[:budget]

    # One HTTP round-trip to fetch all curated schemas for this run.
    raw_tools = await _fetch_curated_schemas(
        space_id=space_id,
        user_id=user_id,
        slugs=flat_slugs,
        base_url=base_url,
        secret=secret,
    )

    seen_names: set[str] = set()
    curated_tools: list[Any] = []
    for spec in raw_tools:
        slug = spec.get("slug") or ""
        toolkit = spec.get("toolkit") or slug_to_toolkit.get(slug.upper(), "")
        if not slug:
            continue
        description = spec.get("description") or slug
        parameters = spec.get("parameters") or {"type": "object", "properties": {}}
        name = _safe_tool_name(slug, toolkit)
        # If two slugs canonicalize to the same name (rare, but a future
        # rename could create one), keep the first; skip the second
        # rather than risk an xAI 400.
        if name in seen_names:
            logger.warning(
                "curated_tool_name_collision_skipped",
                slug=slug,
                toolkit=toolkit,
                name=name,
            )
            continue
        seen_names.add(name)
        try:
            curated_tools.append(
                _build_curated_tool(
                    slug=slug,
                    name=name,
                    description=description,
                    parameters=parameters,
                    toolkit=toolkit,
                    space_id=space_id,
                    user_id=user_id,
                    base_url=base_url,
                    secret=secret,
                )
            )
        except Exception as err:  # noqa: BLE001
            # A single bad schema must not poison the whole load — drop
            # it and continue. The dispatcher still covers this action.
            logger.warning(
                "curated_tool_build_failed",
                slug=slug,
                toolkit=toolkit,
                error=str(err)[:200],
            )

    # Dispatcher fallback — always loaded when ANY toolkit is connected,
    # so the model has a path to the long-tail actions not in curated.
    from tools.integrations_dispatcher import (
        call_integration_tool,
        find_integration_tool,
    )

    extra = [*curated_tools, find_integration_tool, call_integration_tool]

    logger.info(
        "integration_tools_loaded",
        space_id=space_id,
        user_id=user_id,
        connected_toolkits=toolkits,
        curated_count=len(curated_tools),
        curated_requested=len(flat_slugs),
        dispatcher_count=2,
        total=len(extra),
        budget=budget,
    )
    return extra


async def resolve_owner_user_id(space_id: str) -> str | None:
    """For autonomous runs (no user in the request), the workspace OWNER is
    the entity whose connections we use. Returns the owner's Clerk userId
    or None if the chain (Space → User → clerkId) is broken.
    """
    db = await supabase()
    try:
        sp = await (
            db.table("Space")
            .select("ownerId")
            .eq("id", space_id)
            .maybe_single()
            .execute()
        )
        if not sp.data:
            return None
        owner_db_id = sp.data.get("ownerId")
        if not owner_db_id:
            return None
        u = await (
            db.table("User")
            .select("clerkId")
            .eq("id", owner_db_id)
            .maybe_single()
            .execute()
        )
        return (u.data or {}).get("clerkId")
    except Exception as err:  # noqa: BLE001
        logger.warning(
            "resolve_owner_user_id_failed",
            space_id=space_id,
            error=str(err)[:200],
        )
        return None
