"""Studio tool — Chippi generates branded images and video for the realtor.

fal.ai and Wasabi live in the Next.js app, so this tool calls the internal
Studio endpoint (AGENT_INTERNAL_SECRET-authed). Generation, storage, and
usage-metering logic stays in one place — the Next.js side — exactly as
`config.py` intends for agent write operations.
"""

from __future__ import annotations

from typing import Any

import httpx
from agents import RunContextWrapper, function_tool

from config import settings
from security.context import AgentContext
from tools.base import rate_limited

# Video generation can run a few minutes — give the call room.
_TIMEOUT = 300.0


@function_tool(strict_mode=False)
@rate_limited(max_calls=20, window_seconds=3600)
async def generate_studio_image(
    ctx: RunContextWrapper[AgentContext],
    prompt: str,
    model: str | None = None,
) -> dict[str, Any]:
    """Generate a branded image or short video via Studio for the realtor's Files library."""
    # prompt: vivid plain-English description; realtor's brand palette is auto-applied.
    # model: flux-schnell (fast, default), flux-2 (HQ image), seedream-4 (photoreal), seedance-video.
    space_id = ctx.context.space_id

    clean_prompt = (prompt or "").strip()
    if not clean_prompt:
        return {"error": "prompt is required"}

    base_url = (settings.app_url or "").rstrip("/")
    secret = settings.agent_internal_secret
    if not base_url or not secret:
        return {"error": "Studio generation is not configured."}

    payload: dict[str, Any] = {"spaceId": space_id, "prompt": clean_prompt}
    if model:
        payload["model"] = model

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{base_url}/api/internal/studio/generate",
                json=payload,
                headers={"Authorization": f"Bearer {secret}"},
            )
    except Exception as exc:  # noqa: BLE001 — surface to the agent, never throw
        return {"error": f"generation request failed: {exc}"}

    if resp.status_code >= 400:
        detail = ""
        try:
            detail = resp.json().get("error", "")
        except Exception:  # noqa: BLE001
            detail = ""
        return {"error": detail or f"generation failed ({resp.status_code})"}

    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return {"error": "generation returned an unreadable response"}

    return {
        "file_id": data.get("fileId"),
        "url": data.get("url"),
        "kind": data.get("kind"),
        "cost_usd": data.get("costUsd"),
    }


@function_tool(strict_mode=False)
@rate_limited(max_calls=20, window_seconds=3600)
async def edit_studio_image(
    ctx: RunContextWrapper[AgentContext],
    file_id: str,
    tool: str,
    prompt: str | None = None,
) -> dict[str, Any]:
    """Edit an existing image via Studio; saves a NEW image, leaves original untouched."""
    # file_id: id of the source image (e.g. from generate_studio_image).
    # tool: 'upscale' | 'remove-bg' | 'restyle' (restyle requires prompt).
    # prompt: plain-English instruction, required only for restyle.
    space_id = ctx.context.space_id

    clean_file_id = (file_id or "").strip()
    clean_tool = (tool or "").strip()
    if not clean_file_id or not clean_tool:
        return {"error": "file_id and tool are required"}

    base_url = (settings.app_url or "").rstrip("/")
    secret = settings.agent_internal_secret
    if not base_url or not secret:
        return {"error": "Studio editing is not configured."}

    payload: dict[str, Any] = {
        "spaceId": space_id,
        "fileId": clean_file_id,
        "tool": clean_tool,
    }
    if prompt:
        payload["prompt"] = prompt

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{base_url}/api/internal/studio/edit",
                json=payload,
                headers={"Authorization": f"Bearer {secret}"},
            )
    except Exception as exc:  # noqa: BLE001 — surface to the agent, never throw
        return {"error": f"edit request failed: {exc}"}

    if resp.status_code >= 400:
        detail = ""
        try:
            detail = resp.json().get("error", "")
        except Exception:  # noqa: BLE001
            detail = ""
        return {"error": detail or f"edit failed ({resp.status_code})"}

    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return {"error": "edit returned an unreadable response"}

    return {
        "file_id": data.get("fileId"),
        "url": data.get("url"),
        "cost_usd": data.get("costUsd"),
    }
