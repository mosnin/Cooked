"""Modal entrypoint for Chippi.

No Modal-side scheduling — runs are kicked off from the Next.js side
(the 4-hour cron in vercel.json, the "Run now" button, or an event
trigger) which calls these endpoints.

  POST  chat_turn          — interactive chat surface (called by /api/ai/task)
  POST  run_now_webhook    — autonomous run for a single space (or trigger-drain)
  POST  run_swarm_endpoint — swarm execution (called fire-and-forget by /api/swarm)
        run_space          — plain function for local testing / cron drains

Deployment:
  modal deploy agent/modal_app.py

Secrets: a single Modal secret named "chippi-secrets" containing all env
vars listed in config.py.

Sandbox economics — why we stay on Modal (audit, 2026-Q2):
  Chippi uses @app.function + @modal.fastapi_endpoint — Modal's STANDARD
  tier ($0.047/vCPU-hr), not modal.Sandbox tier ($0.142/vCPU-hr). A
  prior audit conflated the two and recommended migration to Daytona
  ($0.0504/vCPU-hr) on a ~3x cost-savings basis that did not exist.
  At standard pricing Modal is cheaper than Daytona, simpler operationally
  (fastapi_endpoint is built in; Daytona would need a fronting FastAPI
  server on Fly/Render plus separate sandbox dispatch), and image-layer
  caching is more mature. Re-evaluate only on: GPU adoption (Modal still
  wins), Modal raising standard pricing >50%, or Chippi adding hostile-
  code execution (which would push us onto sandbox tier and change the
  math). Detailed model + traffic shapes for 10/100/1000 realtor scales
  in commit message of this change.
"""

from __future__ import annotations

import modal
import re
import structlog
from pathlib import Path

logger = structlog.get_logger(__name__)

# Hard ceiling on agent-loop steps for an interactive chat turn. Each step
# re-sends the system prompt + tool schemas + accumulated tool results, so
# total prompt tokens scale with this number. 12 leaves headroom for a real
# multi-step plan (lookup → plan → several writes → confirm) while capping a
# pathological loop that would otherwise burn a whole day's token budget on
# one message.
# Inner agent-loop cap. The SDK re-sends the FULL transcript (system prompt +
# every tool schema + accumulated tool results) on EVERY step, so token cost
# grows quadratically with this number. 8 covers real multi-step workflows
# (lookup → activity → deal → draft is 4-5 steps); deeper work belongs on the
# swarm/delegate path which runs in its own bounded context.
CHAT_MAX_TURNS = 8

# Server-side guard on replayed history. The client caps what it sends, but
# this endpoint must not trust that — an unbounded transcript re-ships on
# every loop step (multiplying every other token cost) regardless of where
# it came from.
CHAT_HISTORY_MAX_ITEMS = 16

# Resolve the agent source directory from this file's location, NOT from the
# deploy cwd. Without this, `modal deploy agent/modal_app.py` (from repo root)
# mounts the WRONG dir at /app — db.py et al land at /app/agent/* and every
# import inside chat_turn fails with ModuleNotFoundError.
_AGENT_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Secret masking — applied to all log output that includes external data
# ---------------------------------------------------------------------------

_SECRET_PATTERNS = [
    (re.compile(r'sk-[A-Za-z0-9]{20,}'), 'sk-[REDACTED]'),
    (re.compile(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*'), 'Bearer [REDACTED]'),
    (re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'), '[email]'),
    (re.compile(r'\+?1?\s*\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}'), '[phone]'),
    (re.compile(r'ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+'), '[jwt]'),
]


def mask_secrets(text: str) -> str:
    if not isinstance(text, str):
        text = str(text)
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text

# ---------------------------------------------------------------------------
# Image
# ---------------------------------------------------------------------------

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        # Upper bounds keep a rebuild from silently pulling a breaking
        # release. openai-agents is pre-1.0 — translate() matches its event
        # class names by name — so it is held to the 0.0.x line. Keep these
        # in sync with agent/pyproject.toml.
        #
        # openai is capped below 1.97 — at 1.97 the SDK made `logprobs`
        # required on ResponseTextDeltaEvent. openai-agents 0.0.x streams
        # chat-completions chunks from non-OpenAI providers (OpenRouter)
        # WITHOUT logprobs, so a chat turn dies with
        # `1 validation error for ResponseTextDeltaEvent / logprobs /
        # Field required` before the first token reaches the client.
        # Upstream fixes shipped in openai-python (PR #2500) and
        # openai-agents 0.2.x (PR #1246); neither is in the version line
        # we're pinned to. Stay below the openai schema change.
        "openai-agents>=0.0.15,<0.1",
        "openai>=1.75.0,<1.97",
        "asyncpg>=0.30.0,<1",
        "pydantic>=2.11.0,<3",
        "pydantic-settings>=2.9.0,<3",
        "httpx>=0.28.0,<1",
        "upstash-redis>=1.3.0,<2",
        "structlog>=25.1.0,<26",
        # Required by Modal's @fastapi_endpoint
        "fastapi[standard]>=0.115.0,<1",
        # Attachment extraction (read_attachment tool)
        "pypdf>=5.0.0,<6",
        "python-docx>=1.1.0,<2",
        "openpyxl>=3.1.0,<4",
        # Composio integrations — load realtor's connected toolkits
        # (Gmail, Slack, HubSpot, etc.) for chat AND autonomous runs.
        # Mirrors lib/integrations/composio.ts. Without these, the
        # Modal-side load_integration_tools() throws ImportError and
        # the agent runs without any integration tools regardless of
        # what's in the IntegrationConnection table.
        #
        # NOTE on package naming: the Composio Python SDK was split.
        # `composio-core` tops out at 0.7.21 (old SDK). The v3 SDK
        # — which matches the TS `@composio/core 0.8.x` shape we use
        # in lib/integrations/composio.ts — is published under the
        # `composio` package at 0.13.x. Use that one.
        "composio>=0.13.0,<0.14",
        "composio-openai-agents>=0.13.0,<0.14",
    )
    .add_local_dir(_AGENT_DIR, remote_path="/app")
)

app = modal.App("chippi-agent", image=image)

secrets = [modal.Secret.from_name("chippi-secrets")]


# ---------------------------------------------------------------------------
# Manual trigger — run a single space on demand
# ---------------------------------------------------------------------------

@app.function(secrets=secrets, timeout=600)
async def run_space(space_id: str) -> None:
    """Run Chippi for one space. Useful for local testing / cron drains."""
    import sys
    sys.path.insert(0, "/app")

    try:
        from db import supabase
        from schemas import AgentSettings, Space
        from orchestrator import run_agent_for_space

        db = await supabase()

        sr = await (
            db.table("AgentSettings").select("*").eq("spaceId", space_id).maybe_single().execute()
        )
        if not sr.data:
            logger.warning("run_space_no_settings", space_id=space_id)
            return

        spr = await (
            db.table("Space").select("id,slug,name").eq("id", space_id).maybe_single().execute()
        )
        if not spr.data:
            logger.warning("run_space_not_found", space_id=space_id)
            return

        agent_settings = AgentSettings.model_validate(sr.data)
        space = Space(id=spr.data["id"], slug=spr.data["slug"], name=spr.data["name"])

        await run_agent_for_space(space, agent_settings)
        logger.info("run_space_done", space_id=space_id)

    except Exception as e:
        masked_error = mask_secrets(str(e))
        logger.error("modal_run_space_failed", error=masked_error, space_id=space_id)
        raise


# ---------------------------------------------------------------------------
# Web endpoint — autonomous run from the UI / trigger queue
# ---------------------------------------------------------------------------

@app.function(secrets=secrets, timeout=600)
@modal.fastapi_endpoint(method="POST")
async def run_now_webhook(item: dict) -> dict:
    """HTTP webhook that runs Chippi autonomously for a space.

    Set MODAL_WEBHOOK_URL in the Next.js env to the URL printed by
    `modal deploy`. Secured with AGENT_INTERNAL_SECRET.
    """
    import os
    import sys
    sys.path.insert(0, "/app")

    try:
        expected = os.environ.get("AGENT_INTERNAL_SECRET", "")
        secret = (item.get("secret") or "")
        if not expected or secret != expected:
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": "Unauthorized"}, status_code=401)

        space_id = (item.get("space_id") or "").strip()
        if not space_id:
            return {"error": "space_id required"}

        # Optional: a routine's standing instruction. When present the run is
        # scoped to it; otherwise it's a trigger/sweep run.
        raw_instruction = item.get("instruction")
        instruction = (
            raw_instruction.strip()[:600] if isinstance(raw_instruction, str) else ""
        )

        # Optional: workspace owner's Clerk userId, pre-resolved by the
        # caller (e.g. /api/cron/routines). Passing it here skips the
        # Modal-side Space → User lookup and avoids the silent-null path
        # where integrations fail to load. Falls back to server-side
        # resolution when absent.
        raw_user_id = item.get("user_id")
        user_id = (
            raw_user_id.strip() if isinstance(raw_user_id, str) else ""
        )

        # Optional: structured trigger provenance. Built by the TS
        # dispatcher (`dispatchTrigger` in lib/integrations/triggers.ts)
        # when this run was kicked by a Composio trigger delivery. We
        # only accept it as a dict — anything else (mismatched shape
        # from a hostile or stale caller) is treated as absent rather
        # than crashing the run.
        raw_trigger_source = item.get("trigger_source")
        trigger_source = (
            raw_trigger_source
            if isinstance(raw_trigger_source, dict)
            else {}
        )

        from db import supabase
        from schemas import AgentSettings, Space
        from orchestrator import run_agent_for_space

        db = await supabase()
        sr = await (
            db.table("AgentSettings").select("*").eq("spaceId", space_id).maybe_single().execute()
        )
        spr = await (
            db.table("Space").select("id,slug,name").eq("id", space_id).maybe_single().execute()
        )
        if not sr.data or not spr.data:
            return {"error": f"space or agent settings not found: {space_id}"}

        await run_agent_for_space(
            Space(id=spr.data["id"], slug=spr.data["slug"], name=spr.data["name"]),
            AgentSettings.model_validate(sr.data),
            instruction=instruction or None,
            owner_clerk_id=user_id or None,
            trigger_source=trigger_source or None,
        )
        return {"ok": True, "space_id": space_id}

    except Exception as e:
        masked_error = mask_secrets(str(e))
        logger.error("modal_run_now_webhook_failed", error=masked_error, space_id=item.get("space_id") if isinstance(item, dict) else None)
        raise


# ---------------------------------------------------------------------------
# Web endpoint — swarm execution (called fire-and-forget by /api/swarm)
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("chippi-secrets")],
    timeout=600,  # 10 min max for swarm runs
    max_containers=10,
)
@modal.fastapi_endpoint(method="POST", label="run-swarm")
async def run_swarm_endpoint(payload: dict) -> dict:
    """Modal endpoint for swarm execution. Called fire-and-forget by /api/swarm.

    Secured with AGENT_INTERNAL_SECRET — same as run_now_webhook and
    chat_turn. The swarm runner writes SwarmRun/SwarmMember/SwarmEvent rows
    and burns LLM tokens for whatever spaceId the payload names, so an
    unauthenticated caller could run billable swarms against any workspace.
    """
    import os

    expected = os.environ.get("AGENT_INTERNAL_SECRET", "")
    secret = (payload.get("secret") or "")
    if not expected or secret != expected:
        from fastapi.responses import JSONResponse
        return JSONResponse({"status": "failed", "error": "Unauthorized"}, status_code=401)

    from swarm_orchestrator import run_swarm
    try:
        await run_swarm(payload)
        return {"status": "completed"}
    except Exception as exc:
        logger.error("run_swarm_endpoint_error", error=str(exc))
        return {"status": "failed", "error": str(exc)}


# ---------------------------------------------------------------------------
# Web endpoint — chat turn (called by /api/ai/task)
# ---------------------------------------------------------------------------
# Runs Chippi inline in this Modal function and streams SDK events back as
# Server-Sent Events. The previous architecture spawned a fresh Sandbox per
# call and piped JSONL through stdin/stdout — that bought no real isolation
# (none of these tools shell out or write outside postgres) and cost 5–15s
# of cold-start on every turn. Inline run, same security boundary, no tax.

@app.function(secrets=secrets, timeout=600)
@modal.fastapi_endpoint(method="POST")
async def chat_turn(item: dict):
    """Run one chat turn for the realtor and stream SDK events as SSE."""
    import json
    import os
    import sys
    import time
    import uuid
    from typing import Any

    # Wall-clock anchor for the per-turn latency log emitted at end-of-stream.
    # Powers the curated-vs-dispatcher latency comparison in
    # docs/integrations-perf-measurement.md — without this log line the
    # measurement plan has nothing to bucket on.
    _turn_started_at = time.monotonic()

    sys.path.insert(0, "/app")

    from fastapi.responses import StreamingResponse

    expected = os.environ.get("AGENT_INTERNAL_SECRET", "")
    secret = (item.get("secret") or "")
    if not expected or secret != expected:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    space_id = (item.get("space_id") or "").strip()
    # Clerk userId of the realtor sending this message. Required for
    # Composio integration loading — connections are scoped per entity
    # (Clerk userId) on Composio's side and per (spaceId, userId) in our
    # IntegrationConnection table. Tolerate missing for backward
    # compatibility with older Next.js deploys; Composio just won't load.
    user_id = (item.get("user_id") or "").strip()
    message = item.get("message") or ""
    if not space_id or not isinstance(message, str) or not message.strip():
        return {"error": "space_id and message required"}

    history = item.get("history") or []
    attachments = item.get("attachments") or []
    conversation_id = item.get("conversation_id") or ""

    # ── Mode dispatch — realtor (default) vs. broker ────────────────────
    # The Next.js layer sends `mode: 'realtor' | 'broker'` so this function
    # picks the right agent (different system prompt + different tool set)
    # without forking the SSE plumbing. Realtor stays the historical
    # default — older Next.js deploys that don't send `mode` keep working.
    #
    # Broker mode also carries `brokerage_id` + `broker_role` from the
    # API-gate's `resolveBrokerContext()`. These flow into AgentContext
    # so the per-tool guard (`tools/broker/_guards.py:require_broker_role`,
    # defense layer 3) can refuse a call whose context isn't broker-shaped.
    raw_mode = item.get("mode")
    mode = (raw_mode or "realtor").strip().lower() if isinstance(raw_mode, str) else "realtor"
    if mode not in ("realtor", "broker"):
        mode = "realtor"
    brokerage_id = (item.get("brokerage_id") or "").strip() if isinstance(item.get("brokerage_id"), str) else ""
    broker_role = (item.get("broker_role") or "").strip().lower() if isinstance(item.get("broker_role"), str) else ""
    # Broker mode must arrive with both context fields. The Next.js API
    # gate is the single point that should ever produce them; missing
    # either is a wiring bug, not a recoverable state.
    if mode == "broker" and (not brokerage_id or broker_role not in ("broker_owner", "broker_admin")):
        return {"error": "broker mode requires brokerage_id and a broker role"}

    from db import supabase
    db = await supabase()

    sr = await (
        db.table("AgentSettings").select("*").eq("spaceId", space_id).maybe_single().execute()
    )
    spr = await (
        db.table("Space").select("id,slug,name").eq("id", space_id).maybe_single().execute()
    )
    if not sr.data or not spr.data:
        return {"error": f"space or agent settings not found: {space_id}"}

    from agents import InputGuardrailTripwireTriggered, ModelSettings, RunConfig, Runner
    from openai.types.shared import Reasoning
    from schemas import AgentSettings, Space
    from security.context import AgentContext
    from chippi import make_chippi_agent
    from chippi_broker import make_broker_agent
    from config import settings
    from llm import (
        decide_reasoning_effort,
        extract_usage_with_cache,
        fallback_models,
        make_chat_model,
        resolve_chat_model,
    )
    from tools.base import result_is_ok

    agent_settings = AgentSettings.model_validate(sr.data)
    space = Space(id=spr.data["id"], slug=spr.data["slug"], name=spr.data["name"])
    resolved_model = resolve_chat_model(agent_settings.chat_model)

    ctx = AgentContext.from_settings(
        agent_settings,
        run_id=conversation_id or f"chat-{uuid.uuid4()}",
        space_name=space.name,
        user_id=user_id,
        brokerage_id=brokerage_id,
        broker_role=broker_role,
    )

    # ── helpers ──────────────────────────────────────────────────────────────────────────

    def attach_message(text: str, atts: list[dict[str, Any]]) -> str:
        if not atts:
            return text
        parts = [text]
        for a in atts:
            if not isinstance(a, dict):
                continue
            mime = (a.get("mime_type") or "").lower()
            if mime.startswith("image/"):
                continue  # vision path handles images directly below
            filename = a.get("filename", "attachment")
            extracted = a.get("extracted_text")
            if extracted:
                parts.append(f"\n\n[Attached {filename}]\n{extracted}")
            else:
                att_id = a.get("id", "")
                parts.append(
                    f"\n\n[Attached {filename} — id {att_id}; "
                    "call read_attachment to retrieve if needed]"
                )
        return "".join(parts)

    def build_user_input(text: str, atts: list[dict[str, Any]]):
        if not atts:
            return text
        image_atts = [
            a for a in atts
            if isinstance(a, dict)
            and (a.get("mime_type") or "").lower().startswith("image/")
            and a.get("public_url")
        ]
        if not image_atts:
            return text
        content: list[dict[str, Any]] = [{"type": "input_text", "text": text}]
        for a in image_atts:
            content.append({"type": "input_image", "image_url": a["public_url"]})
        return content

    def safe_json_loads(value: Any) -> Any:
        if value is None:
            return {}
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (json.JSONDecodeError, ValueError):
                return {"raw": value}
        return {"raw": str(value)}

    def _call_id(it: Any) -> str | None:
        """The SDK call_id that links a tool call to its output.

        The tool-call raw_item (ResponseFunctionToolCall) exposes it as an
        attribute; the output raw_item (FunctionCallOutput) is a dict. Try
        both so the browser can correlate a result to its originating call.
        """
        raw = getattr(it, "raw_item", None)
        if raw is None:
            return None
        cid = getattr(raw, "call_id", None)
        if cid is None and isinstance(raw, dict):
            cid = raw.get("call_id")
        return str(cid) if cid else None

    def translate(event: Any) -> dict | None:
        """Map an OpenAI Agents SDK stream event to our JSONL protocol."""
        name = type(event).__name__

        if name == "RawResponsesStreamEvent":
            data = getattr(event, "data", None)
            if data is None:
                return None
            data_type = getattr(data, "type", "") or ""
            # Forward genuine output_text deltas as tokens.
            # Forward reasoning_text deltas as reasoning_delta (shown in the
            # collapsible "Thinking" section in the client).
            # Filter everything else (function_call_arguments.delta etc.) so
            # raw tool-arg JSON doesn't leak into the chat as model text.
            if data_type == "response.output_text.delta":
                delta = getattr(data, "delta", None)
                if delta:
                    return {"type": "token", "delta": str(delta)}
            elif data_type == "response.reasoning_text.delta":
                delta = getattr(data, "delta", None)
                if delta:
                    return {"type": "reasoning_delta", "delta": str(delta)}
            return None

        if name == "RunItemStreamEvent":
            it = getattr(event, "item", None)
            if it is None:
                return None
            ev_name = getattr(event, "name", "") or ""
            item_type = getattr(it, "type", "") or type(it).__name__

            if ev_name == "tool_called" or item_type in ("tool_call_item", "ToolCallItem"):
                tool_name = (
                    getattr(it, "tool_name", None)
                    or getattr(getattr(it, "raw_item", None), "name", None)
                    or "tool"
                )
                raw_args = getattr(getattr(it, "raw_item", None), "arguments", None)
                return {
                    "type": "tool_call_start",
                    "tool": tool_name,
                    "args": safe_json_loads(raw_args),
                    "call_id": _call_id(it),
                }

            if ev_name == "tool_output" or item_type in ("tool_call_output_item", "ToolCallOutputItem"):
                tool_name = (
                    getattr(it, "tool_name", None)
                    or getattr(getattr(it, "raw_item", None), "name", None)
                    or "tool"
                )
                output = getattr(it, "output", None)
                summary = "" if output is None else str(output)
                if len(summary) > 800:
                    summary = summary[:799] + "…"
                return {
                    "type": "tool_call_result",
                    "tool": tool_name,
                    "ok": result_is_ok(output),
                    "summary": summary,
                    "call_id": _call_id(it),
                }

            return None

        return None

    # ── run ───────────────────────────────────────────────────────────────────────────────

    text_with_attachments = attach_message(message, attachments)
    user_content = build_user_input(text_with_attachments, attachments)

    input_items: list[dict[str, Any]] = []
    # Most-recent CHAT_HISTORY_MAX_ITEMS only — see the constant's comment.
    for turn in history[-CHAT_HISTORY_MAX_ITEMS:]:
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant", "system") and content:
            input_items.append({"role": role, "content": str(content)})
    input_items.append({"role": "user", "content": user_content})

    # Reasoning effort — "low" by default (Phase 1 / PR #155). Phase 3
    # escalates to "medium" when the user message smells like planning or
    # research ("build a plan", "step by step", "compare X to Y", "audit
    # my pipeline"). See agent/llm.py:decide_reasoning_effort.
    reasoning_effort = decide_reasoning_effort(message)
    run_config = RunConfig(
        # Tracing exports only reach OpenAI's backend; disable on a pure-
        # OpenRouter deploy, which may carry no OpenAI key at all.
        tracing_disabled=bool(settings.openrouter_api_key),
        model_settings=ModelSettings(reasoning=Reasoning(effort=reasoning_effort)),
    )

    # Load this realtor's connected-toolkit tools (Gmail, Slack, HubSpot,
    # etc.) before building the agent. Empty list when user_id is missing
    # (older Next.js deploy) or no integrations configured. Best-effort:
    # a Composio outage degrades to native-tool-only chat, doesn't 500.
    #
    # Broker mode skips this entirely — the broker chat surface is the
    # chief-of-staff agent and does not draft on a realtor's behalf from
    # the broker's chat. Cross-realtor outreach is mediated by dedicated
    # broker tools (Phase 3), not by Composio-loaded realtor connections.
    integration_tools: list = []
    connected_toolkits: list[str] = []
    if mode == "realtor" and user_id:
        try:
            from integrations import active_toolkits, load_integration_tools

            # Pull the toolkit list ONCE — surfaced to the model via
            # workspace_info below AND passed into the tool loader (which
            # used to re-query the same table on every turn).
            connected_toolkits = await active_toolkits(space_id, user_id)
            integration_tools = await load_integration_tools(
                space_id, user_id, toolkits=connected_toolkits
            )
        except Exception as ie:  # noqa: BLE001
            logger.warning(
                "load_integration_tools_failed",
                space_id=space_id,
                user_id=user_id,
                error=str(ie)[:200],
            )

    # Workspace info — gives the model the realtor's intake URL up front
    # so any drafted outreach (Gmail/Resend/SMS) can include the link
    # without an extra tool call. app_url already includes scheme + host.
    _app_url = (settings.app_url or "").rstrip("/")
    # A localhost app_url (NEXT_PUBLIC_APP_URL missing from the Modal secret)
    # must never become a customer-facing intake link in a drafted email.
    if "localhost" in _app_url or "127.0.0.1" in _app_url:
        _app_url = ""
    intake_url = f"{_app_url}/apply/{space.slug}" if _app_url and space.slug else ""
    # Tell the model which integrations the realtor actually has connected
    # so it can route by name — "check my google calendar" maps to a
    # connected `googlecalendar` toolkit, "send a slack DM" maps to `slack`.
    # Without this, the model would have to first call find_integration_tool
    # to discover what exists, wasting a turn.
    _toolkit_line = (
        f"- Connected integrations: {', '.join(sorted(connected_toolkits))}\n"
        if connected_toolkits
        else "- Connected integrations: (none)\n"
    )
    workspace_info: str | None = (
        "# Your workspace\n"
        f"- Workspace: {space.name} (slug: {space.slug})\n"
        f"- Intake link (share with new leads): {intake_url}\n"
        + _toolkit_line +
        "- Include the intake link in any contact-facing draft where it"
        " makes sense — when reaching out to a fresh lead, when asking a"
        " prospect to qualify, when nudging someone who never finished"
        " applying. Use the full URL verbatim; no shortening."
    ) if intake_url else None

    # Broker mode gets brokerage context, NOT the realtor block above — the
    # broker agent was previously handed the OWNER's personal workspace info
    # (their intake link + "include it in contact-facing drafts"), which is
    # realtor-persona instruction injected into the brokerage chief-of-staff.
    if mode == "broker":
        workspace_info = (
            "# Brokerage context\n"
            f"- Brokerage id: {brokerage_id}\n"
            f"- Operator role: {broker_role}\n"
            "- You are the brokerage chief-of-staff. Answer about the TEAM —"
            " realtors, routing, performance, revenue — through the broker"
            " tools. You do not have a personal intake link or personal"
            " integrations in this mode."
        )

    async def event_stream():
        try:
            # ── Tool registry selection — Phase 2/3 plug into BROKER_TOOLS ──
            # Phase 2 (read tools) and Phase 3 (write tools) for the broker
            # variant only need to append entries to
            # `agent/tools/broker.BROKER_TOOLS` — `make_broker_agent` reads
            # the list at agent-build time. No edit to this dispatch needed
            # when Phase 2 lands.
            if mode == "broker":
                chippi = make_broker_agent(
                    workspace_info=workspace_info,
                    model=resolved_model,
                )
            else:
                chippi = make_chippi_agent(
                    extra_tools=integration_tools,
                    workspace_info=workspace_info,
                    model=resolved_model,
                )
        except Exception as e:
            err = json.dumps({"type": "error", "message": f"agent build failed: {e}"})
            yield f"data: {err}\n\n"
            return

        # Model fallback — attempt the workspace's model first, then the
        # OpenRouter fallback chain. A retry is only possible BEFORE the
        # first event is streamed to the client; once output is on the wire
        # we are committed to the current model and surface the error.
        models = [resolved_model, *(m for m in fallback_models() if m != resolved_model)]
        streamed = False

        for attempt, model in enumerate(models):
            # `model` is a string slug; wrap it in the SDK Model object so the
            # OpenRouter slug routes via our configured client instead of the
            # SDK's prefix dispatcher (which raises `Unknown prefix: x-ai`).
            chippi.model = make_chat_model(model)
            try:
                # Explicit loop bound. The SDK re-sends the full system prompt
                # + tool-schema block + every accumulated tool result on EACH
                # step, so prompt tokens are the per-step cost times the number
                # of steps. Capping the loop is the hard ceiling on a runaway
                # turn's token bill; a legit plan rarely needs more than this.
                result = Runner.run_streamed(
                    chippi,
                    input=input_items,
                    context=ctx,
                    run_config=run_config,
                    max_turns=CHAT_MAX_TURNS,
                )
                async for event in result.stream_events():
                    try:
                        out = translate(event)
                    except Exception:
                        out = None
                    if out:
                        streamed = True
                        yield f"data: {json.dumps(out, default=str)}\n\n"

                final = getattr(result, "final_output", None)
                final_text = (
                    final if isinstance(final, str) else (str(final) if final is not None else "")
                )
                done = json.dumps({"type": "done", "final_text": final_text})
                yield f"data: {done}\n\n"

                # End-of-turn latency anchor for the curated-vs-dispatcher
                # comparison (docs/integrations-perf-measurement.md). Logged
                # after the `done` frame so a slow telemetry write doesn't
                # delay the realtor's last token.
                logger.info(
                    "chat_turn_finished",
                    space_id=space_id,
                    model=model,
                    turn_latency_ms=int((time.monotonic() - _turn_started_at) * 1000),
                )

                # Record this turn's token cost for the Usage page. Best-effort:
                # a telemetry failure must never surface as a chat error.
                # cached_tokens is the share served from the provider prompt
                # cache (free or discounted); 0 for providers without a cache
                # path on OpenRouter (xAI Grok, Google Gemini today).
                try:
                    from ledger import record_chat_usage

                    tokens_in, tokens_out, _, cached_in = extract_usage_with_cache(result)
                    if tokens_in or tokens_out:
                        await record_chat_usage(
                            space_id=space_id,
                            model=model,
                            prompt_tokens=tokens_in,
                            completion_tokens=tokens_out,
                            cached_tokens=cached_in,
                            user_id=user_id or None,
                            conversation_id=conversation_id or None,
                            # Phase 4 dual-path telemetry: every turn that
                            # reaches the Modal endpoint went through the
                            # router and landed on 'agent' (either as the
                            # initial pick or as a direct→agent escalation).
                            # The TS escalation path tags those rows itself;
                            # everything else here is a primary agent route.
                            route="agent",
                        )
                except Exception:
                    logger.warning("chat_turn_usage_record_failed", space_id=space_id)
                return

            except InputGuardrailTripwireTriggered as exc:
                info = exc.guardrail_result.output.output_info or {}
                reason = info.get("reason", "Run blocked.")
                err = json.dumps({"type": "error", "message": mask_secrets(reason)})
                yield f"data: {err}\n\n"
                return

            except Exception as e:
                err_str = str(e)
                lower = err_str.lower()
                is_rate_limited = "429" in err_str or "rate_limit" in lower
                # A stale/removed model slug returns 404 — fall through to the
                # next model instead of hard-failing the whole turn.
                is_bad_model = (
                    "404" in err_str
                    or "model_not_found" in lower
                    or "does not exist" in lower
                    or "invalid model" in lower
                )
                # Transient provider failure (5xx, timeout, dropped socket) —
                # the most common error in practice, previously surfaced with
                # zero retry. Safe to fall forward: gated on `not streamed`, so
                # nothing is on the wire yet.
                is_transient = (
                    "500" in err_str
                    or "502" in err_str
                    or "503" in err_str
                    or "504" in err_str
                    or "timeout" in lower
                    or "timed out" in lower
                    or "connection error" in lower
                    or "overloaded" in lower
                )
                if (
                    (is_rate_limited or is_bad_model or is_transient)
                    and not streamed
                    and attempt < len(models) - 1
                ):
                    logger.warning(
                        "chat_turn_model_falling_back",
                        model=model,
                        next_model=models[attempt + 1],
                        space_id=space_id,
                        reason="rate_limited" if is_rate_limited else "bad_model",
                    )
                    continue
                masked_error = mask_secrets(err_str)
                logger.error("chat_turn_stream_failed", error=masked_error, space_id=space_id)
                err = json.dumps({"type": "error", "message": masked_error})
                yield f"data: {err}\n\n"
                return

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Local dev entrypoint
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main(space_id: str = "") -> None:
    """Run locally: python modal_app.py --space-id=<id>"""
    if not space_id:
        print("usage: modal run modal_app.py --space-id=<id>")
        return
    run_space.remote(space_id)
