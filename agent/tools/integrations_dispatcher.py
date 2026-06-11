"""Integration dispatcher — discover + invoke Composio tools on demand.

The previous architecture front-loaded every action from every connected
toolkit into the model's tool list. With Gmail + HubSpot + Slack + a few
others, that's 500+ function definitions per turn — past xAI's 200-tool
ceiling and a heavy token cost on every other provider. The dispatcher
collapses that to two tools the model can call only when it needs an
integration:

    find_integration_tool(query)   →  list of {slug, name, description}
    call_integration_tool(slug, arguments_json)  →  the action's result

The model uses find_integration_tool whenever the user asks for something
that needs an external system ("read my last 10 emails", "find HubSpot
contacts in stage X", "post this on LinkedIn"), then calls
call_integration_tool with the slug from the search result.

Both tools proxy through Vercel (see app/api/internal/integrations/
{search,execute}/route.ts) — Modal egress IPs never touch Composio
directly, which keeps the auth surface tidy and dodges IP-allowlist
issues on the Composio side.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import structlog
from agents import RunContextWrapper, function_tool

from config import settings
from security.context import AgentContext
from tools.base import rate_limited

logger = structlog.get_logger()

_SEARCH_TIMEOUT = 30.0
_EXEC_TIMEOUT = 120.0


def _proxy_base() -> tuple[str, str] | None:
    base_url = (settings.app_url or "").rstrip("/")
    secret = settings.agent_internal_secret
    if not base_url or not secret:
        return None
    if "localhost" in base_url or "127.0.0.1" in base_url:
        return None
    return base_url, secret


@function_tool(strict_mode=False)
@rate_limited(max_calls=60, window_seconds=3600)
async def find_integration_tool(
    ctx: RunContextWrapper[AgentContext],
    query: str,
    limit: int = 10,
) -> str:
    """Discover Composio actions across the realtor's connected toolkits."""
    # query: short natural-language description of what you need to do.
    # limit: 1-30, default 10. Returns JSON {tools: [{slug, name, description, toolkit, parameters}]}.
    # Pass slug to call_integration_tool. Don't loop searches — if first miss, tell the realtor.
    proxy = _proxy_base()
    if proxy is None:
        return json.dumps({"tools": [], "error": "integration proxy not configured"})
    base_url, secret = proxy

    clean_query = (query or "").strip()
    safe_limit = max(1, min(30, int(limit) if limit else 10))

    user_id = getattr(ctx.context, "user_id", "")
    if not user_id:
        return json.dumps({
            "tools": [],
            "error": "no realtor identity on this run — integrations unavailable",
        })

    try:
        async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
            resp = await client.post(
                f"{base_url}/api/internal/integrations/search",
                json={
                    "spaceId": ctx.context.space_id,
                    "userId": user_id,
                    "query": clean_query,
                    "limit": safe_limit,
                },
                headers={"Authorization": f"Bearer {secret}"},
            )
    except Exception as err:
        logger.warning(
            "find_integration_tool_request_failed",
            space_id=ctx.context.space_id,
            error=str(err)[:300],
        )
        return json.dumps({"tools": [], "error": f"search request failed: {err}"})

    if resp.status_code >= 400:
        return json.dumps(
            {"tools": [], "error": f"search failed ({resp.status_code})"}
        )

    try:
        data = resp.json()
    except Exception:
        return json.dumps({"tools": [], "error": "unparseable response"})

    tools = data.get("tools") or []
    logger.info(
        "find_integration_tool_results",
        space_id=ctx.context.space_id,
        query=clean_query,
        result_count=len(tools),
        top_slugs=[t.get("slug") for t in tools[:5]],
    )
    return json.dumps({"tools": tools})


@function_tool(strict_mode=False)
@rate_limited(max_calls=300, window_seconds=3600)
async def call_integration_tool(
    ctx: RunContextWrapper[AgentContext],
    slug: str,
    arguments_json: str,
) -> str:
    """Execute one Composio action by slug (use after find_integration_tool)."""
    # slug: from find_integration_tool result (e.g. 'GMAIL_SEND_EMAIL').
    # arguments_json: JSON-encoded args matching the action's parameters schema; '{}' if none.
    # Returns {ok, data?, error?}. Auth error -> tell realtor to reconnect at /settings.
    # 4xx -> re-read schema and retry at most once before asking the realtor.
    proxy = _proxy_base()
    if proxy is None:
        return json.dumps({"ok": False, "error": "integration proxy not configured"})
    base_url, secret = proxy

    clean_slug = (slug or "").strip()
    if not clean_slug:
        return json.dumps({"ok": False, "error": "slug is required"})

    try:
        arguments = json.loads(arguments_json) if arguments_json else {}
    except Exception as err:
        return json.dumps({"ok": False, "error": f"bad arguments JSON: {err}"})

    user_id = getattr(ctx.context, "user_id", "")
    if not user_id:
        return json.dumps({
            "ok": False,
            "error": "no realtor identity on this run — integrations unavailable",
        })

    logger.info(
        "call_integration_tool_invoked",
        space_id=ctx.context.space_id,
        slug=clean_slug,
        arg_keys=list(arguments.keys()) if isinstance(arguments, dict) else [],
    )

    try:
        async with httpx.AsyncClient(timeout=_EXEC_TIMEOUT) as client:
            resp = await client.post(
                f"{base_url}/api/internal/integrations/execute",
                json={
                    "spaceId": ctx.context.space_id,
                    "userId": user_id,
                    "slug": clean_slug,
                    "arguments": arguments,
                },
                headers={"Authorization": f"Bearer {secret}"},
            )
    except Exception as err:
        logger.warning(
            "call_integration_tool_request_failed",
            space_id=ctx.context.space_id,
            slug=clean_slug,
            error=str(err)[:300],
        )
        return json.dumps({"ok": False, "error": f"{clean_slug} request failed: {err}"})

    body_text = resp.text
    if resp.status_code >= 500:
        # Don't swallow the body on 5xx — the route's error envelope (with
        # Composio's code/statusCode/possibleFixes/requestId) is the model's
        # only chance to self-correct or surface the right thing to the
        # realtor. Empty body is the only case where we synthesize.
        return body_text or json.dumps(
            {
                "ok": False,
                "error": f"Composio proxy returned {resp.status_code} with empty body for {clean_slug}",
            }
        )
    return body_text or json.dumps({"ok": True, "data": None})
