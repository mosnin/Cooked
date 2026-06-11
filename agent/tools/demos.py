"""Product demo booking tool — agent schedules a product demo (Demo row) +
mirrors it to the rep's external calendar.

A demo here is a booked product demo / sales meeting with a prospect. The
rep lives in Google Calendar (or Outlook); Axil doesn't own a calendar.
After booking the Demo row, this tool writes through to the connected
external calendar via Composio's GOOGLECALENDAR_CREATE_EVENT and logs a
CalendarEventMirror row as the backup audit record. If no calendar is
connected, the demo is still booked; the calendar surface will teach the
rep to connect.

Contract note: the registered tool name stays `book_demo` and the Demo
table's `propertyAddress` column (mapped from the `property_address`
argument) is held stable — both are shared with the TS runtime + API. In
the sales product that field carries an optional location / product or
account context for the demo, not a street address.

Tenant boundary: spaceId from RunContextWrapper, never an argument.
Contact must belong to the space.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog
from agents import RunContextWrapper, function_tool

from db import supabase
from security.context import AgentContext
from tools.activities import persist_log
from tools.base import idempotent_tool
from tools.streaming import publish_event

log = structlog.get_logger(__name__)

# Composio tool slug — match lib/calendar/mirror.ts. Keep in sync with
# the TS side; the through-write is the same intent on both runtimes.
_GCAL_CREATE_SLUG = "GOOGLECALENDAR_CREATE_EVENT"
_CALENDAR_TOOLKITS = ("googlecalendar", "outlook_calendar")


def _parse_iso(value: str) -> datetime | None:
    try:
        # Accept both 'Z' and explicit offsets
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


@function_tool(strict_mode=False)
@idempotent_tool
async def book_demo(
    ctx: RunContextWrapper[AgentContext],
    contact_id: str,
    starts_at: str,
    duration_minutes: int = 30,
    property_address: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Book a product demo with a prospect + mirror to the connected external calendar."""
    # starts_at: ISO 8601 (include tz; naive = UTC). duration_minutes: 5-240 (default 30).
    # property_address: optional location or product/account context for the demo (free text).
    # Contact must have email on file. Through-writes to Google Calendar if connected.
    space_id = ctx.context.space_id
    db = await supabase()

    # Validate contact + pull canonical name/email/phone for the Demo row.
    check = await (
        db.table("Contact")
        .select("id,name,email,phone")
        .eq("id", contact_id)
        .eq("spaceId", space_id)
        .maybe_single()
        .execute()
    )
    if not check.data:
        return {"error": "Contact not found in space"}
    contact = check.data

    starts = _parse_iso(starts_at)
    if starts is None:
        return {"error": "starts_at must be ISO 8601 (e.g. 2026-05-04T14:00:00-07:00)"}
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=timezone.utc)

    duration = max(5, min(240, int(duration_minutes or 30)))
    ends = starts + timedelta(minutes=duration)

    if starts < datetime.now(timezone.utc) - timedelta(minutes=5):
        return {"error": "starts_at is in the past — pick a future time"}

    guest_name = contact.get("name") or "Guest"
    guest_email = contact.get("email") or ""
    if not guest_email:
        return {"error": "Contact has no email on file — add one before booking"}
    guest_phone = contact.get("phone") or None

    demo_id = str(uuid.uuid4())
    demo_row = {
        "id": demo_id,
        "spaceId": space_id,
        "contactId": contact_id,
        "guestName": guest_name,
        "guestEmail": guest_email,
        "guestPhone": guest_phone,
        "propertyAddress": property_address,
        "notes": notes,
        "startsAt": starts.isoformat(),
        "endsAt": ends.isoformat(),
        "status": "scheduled",
    }

    try:
        result = await db.table("Demo").insert(demo_row).execute()
    except Exception as exc:  # surface DB error to the agent
        return {"error": f"demo insert failed: {exc}"}

    # Best-effort through-write to the rep's external calendar +
    # CalendarEventMirror backup row. The Demo is committed; this seam
    # is what lands the event on Google Calendar so the rep's day
    # view (their actual calendar) reflects it. If no calendar is
    # connected we skip cleanly — the booking still lives in Demo, and
    # the /calendar surface teaches them to connect.
    try:
        await _write_demo_through_to_external_calendar(
            space_id=space_id,
            demo_id=demo_id,
            guest_name=guest_name,
            guest_email=guest_email,
            starts=starts,
            ends=ends,
            property_address=property_address,
            notes=notes,
        )
    except Exception as exc:  # noqa: BLE001 — best-effort
        log.warning(
            "demo_calendar_write_through_outer_failed",
            space_id=space_id,
            demo_id=demo_id,
            error=str(exc)[:300],
        )

    # Activity timeline entry for the contact
    summary_addr = f" at {property_address}" if property_address else ""
    await db.table("ContactActivity").insert({
        "id": str(uuid.uuid4()),
        "contactId": contact_id,
        "spaceId": space_id,
        "type": "note",
        "content": (
            f"[Agent] Demo booked for "
            f"{starts.strftime('%a %b %d, %I:%M%p').replace(' 0', ' ')}"
            f"{summary_addr}. {(notes or '').strip()[:200]}"
        ).strip(),
        "metadata": {
            "source": "agent",
            "agentRunId": ctx.context.run_id,
            "demoId": demo_id,
        },
    }).execute()

    await publish_event(
        ctx.context,
        "action",
        f"Demo booked for {guest_name} — {starts.strftime('%b %d, %I:%M%p')}",
        agent_type=ctx.context.current_agent_type,
        metadata={"contactId": contact_id, "demoId": demo_id},
    )

    # Audit trail for manager rollup
    try:
        await persist_log(
            ctx.context,
            action_type="demo_booked",
            outcome="completed",
            reasoning=f"Demo at {property_address or 'TBD'} on {starts.isoformat()}",
            contact_id=contact_id,
        )
    except Exception:
        pass

    created = result.data[0] if result.data else demo_row
    return {
        "ok": True,
        "demoId": created.get("id", demo_id),
        "startsAt": starts.isoformat(),
        "endsAt": ends.isoformat(),
        "contactId": contact_id,
    }


async def _write_demo_through_to_external_calendar(
    *,
    space_id: str,
    demo_id: str,
    guest_name: str,
    guest_email: str,
    starts: datetime,
    ends: datetime,
    property_address: str | None,
    notes: str | None,
) -> None:
    """Write the demo through to the rep's connected external calendar
    via Composio, then log a CalendarEventMirror row.

    Two-stage best-effort:
      1. Find an active calendar connection (googlecalendar /
         outlook_calendar). No connection → skip everything; the Demo row
         alone is enough.
      2. Hit /api/internal/integrations/execute with the create-event
         slug, then insert the mirror row with the returned external id.
         External write failure still logs the mirror row (intent
         forensics) but with `externalEventId=None`.

    Never raises — the outer caller already guards in try/except for any
    bug here, but staying calm is part of the contract.
    """
    db = await supabase()

    # 1. Find the connection.
    try:
        conn_res = await (
            db.table("IntegrationConnection")
            .select("id, userId, toolkit")
            .eq("spaceId", space_id)
            .in_("toolkit", list(_CALENDAR_TOOLKITS))
            .eq("status", "active")
            .order("toolkit", desc=False)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "calendar_connection_lookup_failed",
            space_id=space_id, demo_id=demo_id, error=str(exc)[:300],
        )
        return
    rows = conn_res.data or []
    if not rows:
        return
    connection = rows[0]
    toolkit = connection.get("toolkit") or ""
    user_id = connection.get("userId") or ""
    if toolkit not in _CALENDAR_TOOLKITS or not user_id:
        return

    # 2. Try the external write via the internal proxy. Lazy import to
    #    keep the cold path light — agent.settings is a heavy module.
    description_parts: list[str] = []
    if property_address:
        description_parts.append(f"Context: {property_address}")
    if guest_email:
        description_parts.append(f"Guest: {guest_name} <{guest_email}>")
    if notes:
        description_parts.append(f"Notes: {notes}")
    description = "\n".join(description_parts) if description_parts else None

    attendees = [{"email": guest_email, "displayName": guest_name}] if guest_email else []

    external_event_id: str | None = None
    try:
        from config import settings  # noqa: WPS433 — local import
        base_url = (settings.app_url or "").rstrip("/")
        secret = settings.agent_internal_secret
        if (
            base_url
            and secret
            and "localhost" not in base_url
            and "127.0.0.1" not in base_url
            and toolkit == "googlecalendar"
        ):
            payload = {
                "spaceId": space_id,
                "userId": user_id,
                "slug": _GCAL_CREATE_SLUG,
                "arguments": {
                    "summary": f"Demo: {guest_name}",
                    "description": description,
                    "start_datetime": starts.isoformat(),
                    "end_datetime": ends.isoformat(),
                    "attendees": attendees,
                },
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{base_url}/api/internal/integrations/execute",
                    json=payload,
                    headers={"Authorization": f"Bearer {secret}"},
                )
            if resp.status_code < 400:
                try:
                    body = resp.json()
                except Exception:  # noqa: BLE001
                    body = {}
                # Composio envelope: {ok, data: {...provider response}}.
                data = body.get("data") if isinstance(body, dict) else None
                if isinstance(data, dict):
                    external_event_id = (
                        data.get("id")
                        or data.get("eventId")
                        or (data.get("response_data") or {}).get("id")
                    )
            else:
                log.warning(
                    "calendar_through_write_non_2xx",
                    space_id=space_id, demo_id=demo_id, status=resp.status_code,
                )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "calendar_through_write_failed",
            space_id=space_id, demo_id=demo_id, error=str(exc)[:300],
        )

    # 3. Mirror row — always insert, even on external failure. Intent is
    #    the unit of forensics.
    try:
        await (
            db.table("CalendarEventMirror")
            .insert({
                "spaceId": space_id,
                "externalProvider": toolkit,
                "externalEventId": external_event_id,
                "title": f"Demo: {guest_name}",
                "start": starts.isoformat(),
                "end": ends.isoformat(),
                "attendees": attendees,
                "sourceDemoId": demo_id,
                "createdBy": "agent",
            })
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "calendar_mirror_insert_failed",
            space_id=space_id, demo_id=demo_id, error=str(exc)[:300],
        )
