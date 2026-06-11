"""Draft message tool — and the explicit-send escape hatches.

draft_message is the DEFAULT outreach path: every contact-facing message
lands in the realtor's approval inbox as an AgentDraft, and the realtor
approves before anything ships. Routines and autonomous runs always
draft — the trust boundary.

send_email_now / send_sms_now are the EXPLICIT-INTENT escape hatches: when
the realtor uses imperative verbs ("send", "fire off", "shoot them"),
those tools dispatch immediately through the existing /api/agent/send
delivery path (Resend for email, Telnyx for SMS) and log a ContactActivity
row instead of creating a draft. No AgentDraft row, no approval step.
The realtor is in control — they asked, we ship.

draft_message auto-dedupes: if a draft for the same contact + channel was
created in the last 48 hours and is still pending, the existing draft is
returned instead of a new one. Prevents the agent from burying the realtor
in copies when it loops.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from agents import RunContextWrapper, function_tool

from config import settings
from db import supabase
from errors import from_supabase_error, from_exception
from security.context import AgentContext
from tools.activities import persist_log
from tools.base import idempotent_tool, rate_limited, with_retry
from tools.streaming import publish_event

_VALID_CHANNELS = {"sms", "email", "note"}
_DEDUPE_WINDOW_HOURS = 48
# Send-now delivery proxy timeout — must comfortably cover Resend / Telnyx
# round trips with retries. Matches the integrations dispatcher exec timeout.
_SEND_NOW_TIMEOUT = 60.0


@function_tool(strict_mode=False)
@idempotent_tool
async def draft_message(
    ctx: RunContextWrapper[AgentContext],
    channel: str,
    content: str,
    reasoning: str,
    contact_id: str | None = None,
    recipient_email: str | None = None,
    recipient_phone: str | None = None,
    subject: str | None = None,
    deal_id: str | None = None,
    priority: int = 0,
) -> dict[str, Any]:
    """Draft a person-facing message for realtor approval; canonical outreach path."""
    # channel: 'sms' | 'email' | 'note'. subject required for email. SMS keep <160 chars.
    # Identify recipient by contact_id OR recipient_email OR recipient_phone (auto-stubs if missing).
    # reasoning is shown to realtor. priority 0-100 orders the inbox.
    # Auto-dedup: existing pending draft (same contact+channel, <48h) returned, not duplicated.
    # Quote nextStep in your reply so the trust boundary stays visible.
    space_id = ctx.context.space_id

    if channel not in _VALID_CHANNELS:
        agent_err = from_supabase_error({"message": f"channel must be one of {_VALID_CHANNELS}", "code": None})
        return {"error": agent_err.message, "code": agent_err.code, "retryable": agent_err.retryable}
    if channel == "email" and not subject:
        agent_err = from_supabase_error({"message": "subject is required for email channel", "code": None})
        return {"error": agent_err.message, "code": agent_err.code, "retryable": agent_err.retryable}

    if not contact_id and not recipient_email and not recipient_phone:
        return {
            "error": "Provide one of: contact_id, recipient_email, recipient_phone",
            "code": "MISSING_RECIPIENT",
            "retryable": False,
        }

    db = await supabase()

    # ── Resolve recipient → contactId ────────────────────────────────────
    # If contact_id was passed, verify it. Otherwise look up by email or
    # phone in this space; auto-create a stub if missing so the realtor's
    # explicit "send X to Y" never gets blocked on contact bookkeeping.
    auto_created = False
    contact_name: str | None = None

    if contact_id:
        check = await (
            db.table("Contact")
            .select("id,name")
            .eq("id", contact_id)
            .eq("spaceId", space_id)
            .maybe_single()
            .execute()
        )
        if not check.data:
            agent_err = from_supabase_error({"message": "Contact not found in space", "code": None})
            return {"error": agent_err.message, "code": agent_err.code, "retryable": agent_err.retryable}
        contact_name = check.data.get("name", "contact")
    else:
        # Look up by email or phone first.
        clean_email = (recipient_email or "").strip().lower() or None
        clean_phone = (recipient_phone or "").strip() or None
        lookup = db.table("Contact").select("id,name").eq("spaceId", space_id)
        if clean_email:
            lookup = lookup.ilike("email", clean_email)
        elif clean_phone:
            lookup = lookup.eq("phone", clean_phone)
        found = await lookup.limit(1).maybe_single().execute()
        if found and found.data:
            contact_id = found.data["id"]
            contact_name = found.data.get("name", "contact")
        else:
            # Auto-create a minimal stub. Name guessed from the email local
            # part ("jane.doe" → "Jane Doe") so the realtor sees something
            # readable in their inbox. The realtor can edit later.
            new_id = str(uuid.uuid4())
            if clean_email:
                local = clean_email.split("@", 1)[0]
                guessed_name = local.replace(".", " ").replace("_", " ").replace("-", " ").title()
            else:
                guessed_name = (clean_phone or "Unknown").strip()
            # The Contact table has DEFAULT now() on createdAt/updatedAt.
            # Don't pass them from Python — the underlying asyncpg pool
            # rejects ISO strings for TIMESTAMPTZ columns (`expected a
            # datetime.date or datetime.datetime instance, got 'str'`),
            # which broke every auto-stub insert. Let Postgres own the
            # timestamps.
            stub: dict[str, Any] = {
                "id": new_id,
                "spaceId": space_id,
                "name": guessed_name[:200] or "Unknown",
                "leadType": "buyer",
                "type": "QUALIFICATION",
                "properties": [],
                "tags": ["auto-created"],
            }
            if clean_email:
                stub["email"] = clean_email[:320]
            if clean_phone:
                stub["phone"] = clean_phone[:40]
            try:
                await db.table("Contact").insert(stub).execute()
            except Exception as e:
                agent_err = from_exception(e)
                return {"error": f"auto-create contact failed: {agent_err.message}", "code": agent_err.code, "retryable": agent_err.retryable}
            contact_id = new_id
            contact_name = stub["name"]
            auto_created = True

    # ── Dedup: existing pending draft for same contact+channel in window ──
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=_DEDUPE_WINDOW_HOURS)).isoformat()
    existing = await (
        db.table("AgentDraft")
        .select("id,channel,content,createdAt")
        .eq("spaceId", space_id)
        .eq("contactId", contact_id)
        .eq("channel", channel)
        .eq("status", "pending")
        .gte("createdAt", cutoff)
        .order("createdAt", desc=True)
        .limit(1)
        .execute()
    )
    if existing.data:
        prior = existing.data[0]
        return {
            "action": "deduped",
            "draftId": prior["id"],
            "contactId": contact_id,
            "channel": channel,
            "note": "A pending draft for this contact already exists from the last 48h.",
            "nextStep": (
                f"Already had a pending draft for {contact_name} from the last 48h — "
                "open your inbox to send or edit it."
            ),
        }

    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    # Stamp trigger provenance on the row when this run was kicked by a
    # Composio trigger. Inbox UI reads AgentDraft.triggerSource to render
    # the "Chippi noticed because…" breadcrumb so the realtor sees WHY a
    # draft appeared. Empty dict = chat / routine / sweep run — column
    # stays null and the breadcrumb is hidden.
    trigger_source_raw = getattr(ctx.context, "trigger_source", None) or {}
    trigger_source = trigger_source_raw if trigger_source_raw else None
    draft = {
        "id": str(uuid.uuid4()),
        "spaceId": space_id,
        "contactId": contact_id,
        "dealId": deal_id,
        "channel": channel,
        "subject": subject,
        "content": content,
        "reasoning": reasoning,
        "triggerSource": trigger_source,
        "priority": max(0, min(100, priority)),
        "status": "pending",
        "expiresAt": expires_at,
    }

    try:
        result = await with_retry(lambda: db.table("AgentDraft").insert(draft).execute())
    except Exception as e:
        agent_err = from_exception(e)
        return {"error": agent_err.message, "code": agent_err.code, "retryable": agent_err.retryable}

    await publish_event(
        ctx.context,
        "draft",
        f"Draft {channel.upper()} for {contact_name} — awaiting your approval",
        metadata={"contactId": contact_id, "channel": channel},
    )

    try:
        await persist_log(
            ctx.context,
            action_type="message_drafted",
            outcome="queued_for_approval",
            reasoning=f"{channel}: {reasoning[:200]}",
            contact_id=contact_id,
            deal_id=deal_id,
        )
    except Exception:
        # The AgentDraft row already committed — logging is best-effort.
        pass

    created = result.data[0] if result.data else draft
    if auto_created:
        next_step = (
            "Drafted — review and approve in your inbox to send. "
            f"(Auto-created a contact stub for {contact_name} since they "
            "weren't in your CRM yet — edit the name in Contacts if you'd like.)"
        )
    else:
        next_step = "Drafted — review and approve in your inbox to send. I never send for you without approval."
    return {
        "action": "drafted",
        "draftId": created.get("id", ""),
        "contactId": contact_id,
        "channel": channel,
        "autoCreatedContact": auto_created,
        "nextStep": next_step,
    }


# ── Send-now escape hatches ─────────────────────────────────────────────
# draft_message is the DEFAULT. send_email_now and send_sms_now are the
# explicit-intent paths the agent reaches for only when the realtor used
# imperative verbs ("send", "fire off", "shoot them"). Both skip the
# AgentDraft pipeline entirely and dispatch through /api/agent/send, which
# already handles transport (Resend for email, Telnyx for SMS), contact
# ownership validation, and ContactActivity logging.
#
# Shared invariants:
#   - Resolve recipient via contact_id OR recipient_email/phone (same
#     resolution rules as draft_message, including auto-stub creation).
#   - Never create an AgentDraft row.
#   - publish_event so the realtor sees the send land in the activity feed.
#   - persist_log with action_type='message_sent', outcome='completed'
#     so the broker rollup sees a real send, not a draft.


async def _resolve_or_stub_contact(
    *,
    db: Any,
    space_id: str,
    contact_id: str | None,
    recipient_email: str | None,
    recipient_phone: str | None,
) -> tuple[str | None, str | None, bool, dict | None]:
    """Resolve a contact_id (validating ownership) or auto-create a stub.

    Returns (contact_id, contact_name, auto_created, error_dict_or_None).
    Mirrors the resolution logic inside draft_message — keeps the trust
    contract identical between the draft path and the send-now path
    (auto-stubbing the contact so the activity row has somewhere to live).
    """
    if contact_id:
        check = await (
            db.table("Contact")
            .select("id,name,email,phone")
            .eq("id", contact_id)
            .eq("spaceId", space_id)
            .maybe_single()
            .execute()
        )
        if not check.data:
            agent_err = from_supabase_error({"message": "Contact not found in space", "code": None})
            return None, None, False, {
                "error": agent_err.message,
                "code": agent_err.code,
                "retryable": agent_err.retryable,
            }
        return contact_id, check.data.get("name", "contact"), False, None

    clean_email = (recipient_email or "").strip().lower() or None
    clean_phone = (recipient_phone or "").strip() or None
    lookup = db.table("Contact").select("id,name,email,phone").eq("spaceId", space_id)
    if clean_email:
        lookup = lookup.ilike("email", clean_email)
    elif clean_phone:
        lookup = lookup.eq("phone", clean_phone)
    found = await lookup.limit(1).maybe_single().execute()
    if found and found.data:
        return found.data["id"], found.data.get("name", "contact"), False, None

    new_id = str(uuid.uuid4())
    if clean_email:
        local = clean_email.split("@", 1)[0]
        guessed_name = local.replace(".", " ").replace("_", " ").replace("-", " ").title()
    else:
        guessed_name = (clean_phone or "Unknown").strip()
    stub: dict[str, Any] = {
        "id": new_id,
        "spaceId": space_id,
        "name": guessed_name[:200] or "Unknown",
        "leadType": "buyer",
        "type": "QUALIFICATION",
        "properties": [],
        "tags": ["auto-created"],
    }
    if clean_email:
        stub["email"] = clean_email[:320]
    if clean_phone:
        stub["phone"] = clean_phone[:40]
    try:
        await db.table("Contact").insert(stub).execute()
    except Exception as e:
        agent_err = from_exception(e)
        return None, None, False, {
            "error": f"auto-create contact failed: {agent_err.message}",
            "code": agent_err.code,
            "retryable": agent_err.retryable,
        }
    return new_id, stub["name"], True, None


def _send_now_proxy() -> tuple[str, str] | None:
    """Resolve the (app_url, secret) pair the /api/agent/send proxy needs.

    Mirrors the dispatcher's guard: a localhost app_url means the Modal
    secret wasn't set, and we must not pretend to send through it.
    Returns None when the proxy isn't configured.
    """
    base_url = (settings.app_url or "").rstrip("/")
    secret = settings.agent_internal_secret
    if not base_url or not secret:
        return None
    if "localhost" in base_url or "127.0.0.1" in base_url:
        return None
    return base_url, secret


async def _dispatch_send_now(
    *,
    space_id: str,
    run_id: str,
    contact_id: str,
    channel: str,
    content: str,
    subject: str | None,
) -> dict[str, Any]:
    """POST to /api/agent/send and unwrap the response into a tool result.

    Returns either {ok: True, deliveredTo: ...} on success or
    {error: "...", code: "...", retryable: bool} on any failure mode the
    proxy reports. Network errors are surfaced as retryable; HTTP 4xx is
    surfaced as non-retryable (bad payload, missing contact field, etc.).
    """
    proxy = _send_now_proxy()
    if proxy is None:
        return {
            "error": "Send-now proxy is not configured. Reconnect your account in Settings or use draft mode instead.",
            "code": "PROXY_UNCONFIGURED",
            "retryable": False,
        }
    base_url, secret = proxy

    payload: dict[str, Any] = {
        "contactId": contact_id,
        "spaceId": space_id,
        "channel": channel,
        "content": content,
        "runId": run_id,
    }
    if subject is not None:
        payload["subject"] = subject

    try:
        async with httpx.AsyncClient(timeout=_SEND_NOW_TIMEOUT) as client:
            resp = await client.post(
                f"{base_url}/api/agent/send",
                json=payload,
                headers={"Authorization": f"Bearer {secret}"},
            )
    except Exception as exc:  # noqa: BLE001
        return {
            "error": f"Delivery request failed: {exc}",
            "code": "NETWORK_ERROR",
            "retryable": True,
        }

    try:
        body = resp.json()
    except Exception:
        body = {}

    if resp.status_code >= 500:
        return {
            "error": body.get("error") or f"Delivery service returned {resp.status_code}.",
            "code": "DELIVERY_5XX",
            "retryable": True,
        }
    if resp.status_code >= 400:
        return {
            "error": body.get("error") or f"Delivery rejected ({resp.status_code}).",
            "code": "DELIVERY_4XX",
            "retryable": False,
        }
    return {"ok": True, "deliveredTo": body.get("deliveredTo")}


def _short_preview(text: str, limit: int = 60) -> str:
    """Compact one-line preview for the summary field. Strips newlines."""
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: limit - 1].rstrip()}…"


@function_tool(strict_mode=False)
@rate_limited(max_calls=10, window_seconds=3600)
async def send_email_now(
    ctx: RunContextWrapper[AgentContext],
    content: str,
    subject: str,
    reasoning: str,
    contact_id: str | None = None,
    recipient_email: str | None = None,
    deal_id: str | None = None,
) -> dict[str, Any]:
    """Send an email immediately, bypassing the approval queue."""
    # ONLY when the realtor used an imperative verb ("send", "fire off", "ship it").
    # Routines / autonomous turns must use draft_message instead.
    # Identify by contact_id or recipient_email (auto-stubs if no match).
    # On failure returns {error, code, retryable}; surface in plain English, don't blindly retry.
    space_id = ctx.context.space_id
    if not subject or not subject.strip():
        return {
            "error": "subject is required for send_email_now",
            "code": "MISSING_SUBJECT",
            "retryable": False,
        }
    if not content or not content.strip():
        return {
            "error": "content is required for send_email_now",
            "code": "MISSING_CONTENT",
            "retryable": False,
        }
    if not contact_id and not recipient_email:
        return {
            "error": "Provide one of: contact_id, recipient_email",
            "code": "MISSING_RECIPIENT",
            "retryable": False,
        }

    db = await supabase()
    resolved_id, contact_name, auto_created, err = await _resolve_or_stub_contact(
        db=db,
        space_id=space_id,
        contact_id=contact_id,
        recipient_email=recipient_email,
        recipient_phone=None,
    )
    if err is not None or not resolved_id:
        return err or {"error": "Recipient resolution failed", "code": "UNKNOWN", "retryable": False}

    send_result = await _dispatch_send_now(
        space_id=space_id,
        run_id=ctx.context.run_id,
        contact_id=resolved_id,
        channel="email",
        content=content,
        subject=subject.strip(),
    )
    if "error" in send_result:
        return send_result

    delivered_to = send_result.get("deliveredTo")
    preview = _short_preview(content, 60)
    summary = (
        f"Sent to {contact_name}: \"{preview}\""
        if contact_name
        else f"Sent: \"{preview}\""
    )

    await publish_event(
        ctx.context,
        "action",
        f"Email sent to {contact_name or delivered_to or 'recipient'}",
        agent_type=ctx.context.current_agent_type,
        metadata={"contactId": resolved_id, "channel": "email", "subject": subject.strip()[:120]},
    )

    try:
        await persist_log(
            ctx.context,
            action_type="message_sent",
            outcome="completed",
            reasoning=f"email send-now: {reasoning[:200]}",
            contact_id=resolved_id,
            deal_id=deal_id,
        )
    except Exception:
        pass

    return {
        "ok": True,
        "action": "sent",
        "channel": "email",
        "contactId": resolved_id,
        "deliveredTo": delivered_to,
        "autoCreatedContact": auto_created,
        "summary": summary,
    }


@function_tool(strict_mode=False)
@rate_limited(max_calls=5, window_seconds=3600)
async def send_sms_now(
    ctx: RunContextWrapper[AgentContext],
    content: str,
    reasoning: str,
    contact_id: str | None = None,
    recipient_phone: str | None = None,
    deal_id: str | None = None,
) -> dict[str, Any]:
    """Send an SMS immediately, bypassing the approval queue."""
    # ONLY when the realtor used an imperative verb. Routines must use draft_message.
    # Identify by contact_id or recipient_phone (auto-stubs if no match).
    # Keep content <160 chars; Telnyx fragments longer messages.
    space_id = ctx.context.space_id
    if not content or not content.strip():
        return {
            "error": "content is required for send_sms_now",
            "code": "MISSING_CONTENT",
            "retryable": False,
        }
    if not contact_id and not recipient_phone:
        return {
            "error": "Provide one of: contact_id, recipient_phone",
            "code": "MISSING_RECIPIENT",
            "retryable": False,
        }

    db = await supabase()
    resolved_id, contact_name, auto_created, err = await _resolve_or_stub_contact(
        db=db,
        space_id=space_id,
        contact_id=contact_id,
        recipient_email=None,
        recipient_phone=recipient_phone,
    )
    if err is not None or not resolved_id:
        return err or {"error": "Recipient resolution failed", "code": "UNKNOWN", "retryable": False}

    send_result = await _dispatch_send_now(
        space_id=space_id,
        run_id=ctx.context.run_id,
        contact_id=resolved_id,
        channel="sms",
        content=content,
        subject=None,
    )
    if "error" in send_result:
        return send_result

    delivered_to = send_result.get("deliveredTo")
    preview = _short_preview(content, 60)
    summary = (
        f"Texted {contact_name}: \"{preview}\""
        if contact_name
        else f"Texted: \"{preview}\""
    )

    await publish_event(
        ctx.context,
        "action",
        f"SMS sent to {contact_name or delivered_to or 'recipient'}",
        agent_type=ctx.context.current_agent_type,
        metadata={"contactId": resolved_id, "channel": "sms"},
    )

    try:
        await persist_log(
            ctx.context,
            action_type="message_sent",
            outcome="completed",
            reasoning=f"sms send-now: {reasoning[:200]}",
            contact_id=resolved_id,
            deal_id=deal_id,
        )
    except Exception:
        pass

    return {
        "ok": True,
        "action": "sent",
        "channel": "sms",
        "contactId": resolved_id,
        "deliveredTo": delivered_to,
        "autoCreatedContact": auto_created,
        "summary": summary,
    }
