"""Broker read tools — team-wide capacity, per-realtor performance, morning mirror.

Three tools live here because they all answer the broker's question "what's
happening on the team?" from three zoom levels:

  team_health()                 — every realtor at a glance, with a load_signal
                                  classification per person and the team median
                                  response speed as a context benchmark.
  realtor_performance(id)       — drill into one realtor: deals by stage, GCI,
                                  conversion percentage, response speed, last
                                  activity. Cross-brokerage drill is refused.
  read_realtor_morning_story(id) — mirror what the realtor sees on their own
                                  /chippi home, scoped to that realtor's space.
                                  PII-safe: the broker sees the realtor's
                                  surface, not their private notes/threads.

All three call `require_broker_role(ctx)` first (defense layer 3) and scope
every read through `Space WHERE brokerageId = ctx.brokerage_id`. Cross-
brokerage queries return `BrokerPermissionError`, not empty data — a silent
empty is indistinguishable from a permissions bug.

The team-median + load_signal heuristics are intentionally simple:
  - one number per realtor (open_load = active_deals + open_leads)
  - one number per realtor (avg_response_hours_7d)
  - team median is the seven-day brokerage median, used as a "vs benchmark"
    framing in the broker's chat so Chippi reports facts, not judgments.
"""

from __future__ import annotations

import asyncio
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from agents import RunContextWrapper, function_tool

from db import supabase
from security.context import AgentContext

from ._guards import BrokerPermissionError, require_broker_role


# ── Shared constants ────────────────────────────────────────────────────────

# Activity types that count as outbound contact with a human. Matches the
# convention in `app/api/broker/morning/route.ts`:
#   call / email / meeting → outbound. note / follow_up → private memory.
_OUTBOUND_TYPES: tuple[str, ...] = ("call", "email", "meeting")

# Window for response-time + last-active calculations.
_RESPONSE_WINDOW_DAYS = 7
_RECENT_ACTIVE_WINDOW_DAYS = 30

# load_signal thresholds (see docstring in team_health for source of truth).
_OVERLOADED_OPEN_THRESHOLD = 15
_OVERLOADED_RESPONSE_HOURS = 24.0
_UNDERUSED_OPEN_THRESHOLD = 3


# ── Internal helpers (private, no @function_tool) ───────────────────────────


async def _team_spaces(brokerage_id: str) -> list[dict[str, Any]]:
    """Resolve the brokerage's realtor spaces in one query.

    Returns rows shaped {id, ownerId, name}. Empty list if the brokerage has
    no spaces yet. The caller pairs ownerId → User to get realtor names; we
    keep that join in the tool body so this helper stays narrow.
    """
    db = await supabase()
    res = await (
        db.table("Space")
        .select("id,ownerId,name")
        .eq("brokerageId", brokerage_id)
        .execute()
    )
    return res.data or []


async def _users_by_id(user_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch User rows keyed by id for a list of userIds."""
    if not user_ids:
        return {}
    db = await supabase()
    res = await (
        db.table("User")
        .select("id,name,email,createdAt")
        .in_("id", user_ids)
        .execute()
    )
    return {u["id"]: u for u in (res.data or [])}


def _parse_iso(value: Any) -> datetime | None:
    """Parse an ISO-8601 timestamp returned by asyncpg or the wire format."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _hours_since(dt: datetime | None, now: datetime) -> float | None:
    if not dt:
        return None
    delta = (now - dt).total_seconds() / 3600.0
    return round(max(0.0, delta), 2)


async def _response_hours_for_space(
    space_id: str,
    since: datetime,
    now: datetime,
) -> list[float]:
    """Per-contact response hours: createdAt → first outbound activity.

    Returns one float per contact in the window. A contact with no outbound
    is excluded (we can't infer "slow"; we'd be inferring "no contact yet").
    The realtor side never sees raw values — they roll up into a median.
    """
    db = await supabase()
    # Window is anchored on Contact.createdAt — only contacts created in the
    # last 7 days are considered. This is the operative response-speed metric:
    # how fast did the realtor get back to the lead after it arrived?
    contacts_res = await (
        db.table("Contact")
        .select("id,createdAt")
        .eq("spaceId", space_id)
        .gte("createdAt", since)
        .limit(500)
        .execute()
    )
    contacts = contacts_res.data or []
    if not contacts:
        return []
    contact_ids = [c["id"] for c in contacts if c.get("id")]
    if not contact_ids:
        return []

    # Pull every outbound activity for those contacts. We compute first-touch
    # per contact in Python — the SQL-side MIN() with GROUP BY is supported
    # by asyncpg but the QueryBuilder shim doesn't expose it. The window is
    # narrow (≤500 contacts × outbound rows) so the cost is negligible.
    activities_res = await (
        db.table("ContactActivity")
        .select("contactId,createdAt")
        .in_("contactId", contact_ids)
        .in_("type", list(_OUTBOUND_TYPES))
        .execute()
    )
    activities = activities_res.data or []

    first_outbound: dict[str, datetime] = {}
    for row in activities:
        cid = row.get("contactId")
        ts = _parse_iso(row.get("createdAt"))
        if not cid or not ts:
            continue
        prev = first_outbound.get(cid)
        if prev is None or ts < prev:
            first_outbound[cid] = ts

    hours: list[float] = []
    for c in contacts:
        cid = c.get("id")
        created = _parse_iso(c.get("createdAt"))
        if not cid or not created:
            continue
        first = first_outbound.get(cid)
        if not first:
            continue
        delta = (first - created).total_seconds() / 3600.0
        if delta < 0:
            # Backdated activity — skip rather than report a negative.
            continue
        hours.append(round(delta, 2))
    return hours


async def _last_active_at(space_id: str) -> datetime | None:
    """Most-recent outbound activity timestamp in a space."""
    db = await supabase()
    res = await (
        db.table("ContactActivity")
        .select("createdAt")
        .eq("spaceId", space_id)
        .in_("type", list(_OUTBOUND_TYPES))
        .order("createdAt", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    return _parse_iso(rows[0].get("createdAt"))


def _load_signal(open_load: int, avg_response_hours: float | None, last_active: datetime | None, now: datetime) -> str:
    """Classify a realtor's load. See docstring on team_health for thresholds."""
    if open_load > _OVERLOADED_OPEN_THRESHOLD:
        return "overloaded"
    if avg_response_hours is not None and avg_response_hours > _OVERLOADED_RESPONSE_HOURS:
        return "overloaded"
    recently_active = (
        last_active is not None
        and (now - last_active) <= timedelta(days=_RECENT_ACTIVE_WINDOW_DAYS)
    )
    if open_load < _UNDERUSED_OPEN_THRESHOLD and recently_active:
        return "underused"
    return "healthy"


# ── Tools ───────────────────────────────────────────────────────────────────


@function_tool(strict_mode=False)
async def team_health(ctx: RunContextWrapper[AgentContext]) -> dict[str, Any]:
    """Read every realtor's current capacity, load, and 7-day response speed."""
    # Per-realtor: active_deals, open_leads, avg_response_hours_7d, load_signal.
    # load_signal: overloaded (>15 open OR >24h resp), underused (<3 open + active <30d), healthy.
    # team_median_response_hours_7d returned as a benchmark; frame as comparison, not judgment.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=_RESPONSE_WINDOW_DAYS)

    spaces = await _team_spaces(brokerage_id)
    if not spaces:
        return {
            "ok": True,
            "realtors": [],
            "team_median_response_hours_7d": None,
        }

    user_ids = [s["ownerId"] for s in spaces if s.get("ownerId")]
    users = await _users_by_id(user_ids)

    db = await supabase()

    # Per-realtor stats as a coroutine so the roster runs in PARALLEL —
    # the sequential version paid 5 DB round-trips per realtor in series
    # (100 sequential queries for a 20-agent floor) before answering.
    async def _stats(space: dict[str, Any]) -> tuple[dict[str, Any], list[float]]:
        space_id = space["id"]
        owner_id = space.get("ownerId")
        user = users.get(owner_id) if owner_id else None
        name = (user or {}).get("name") or (user or {}).get("email") or "Realtor"

        # Active deals — status='active'.
        active_deals_res = await (
            db.table("Deal")
            .select("id")
            .eq("spaceId", space_id)
            .eq("status", "active")
            .limit(2000)
            .execute()
        )
        active_deals = len(active_deals_res.data or [])

        # Open leads — Contact in QUALIFICATION pipeline stage.
        leads_res = await (
            db.table("Contact")
            .select("id")
            .eq("spaceId", space_id)
            .eq("type", "QUALIFICATION")
            .limit(2000)
            .execute()
        )
        open_leads = len(leads_res.data or [])

        # Response hours for this realtor.
        hours = await _response_hours_for_space(space_id, since, now)
        avg_response = round(statistics.mean(hours), 2) if hours else None

        last_active = await _last_active_at(space_id)

        signal = _load_signal(active_deals + open_leads, avg_response, last_active, now)

        return (
            {
                "id": owner_id,
                "name": name,
                "active_deals": active_deals,
                "open_leads": open_leads,
                "avg_response_hours_7d": avg_response,
                "last_active_at": last_active.isoformat() if last_active else None,
                "load_signal": signal,
            },
            hours,
        )

    gathered = await asyncio.gather(*(_stats(s) for s in spaces))
    realtors: list[dict[str, Any]] = [entry for entry, _ in gathered]
    all_response_hours: list[float] = [h for _, hours in gathered for h in hours]

    team_median = (
        round(statistics.median(all_response_hours), 2)
        if all_response_hours else None
    )

    return {
        "ok": True,
        "realtors": realtors,
        "team_median_response_hours_7d": team_median,
    }


@function_tool(strict_mode=False)
async def realtor_performance(
    ctx: RunContextWrapper[AgentContext],
    realtor_id: str,
) -> dict[str, Any]:
    """Deep-dive on one realtor: deals by stage/status, conversion, YTD GCI, response speed."""
    # Cross-brokerage drill raises BrokerPermissionError.
    # deals_by_stage keyed by actual DealStage.name. deals_by_status: active|won|lost|on_hold.
    # GCI = sum(value * commissionRate / 100) over won deals; YTD = current calendar year.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()

    # Cross-brokerage guard — resolve the realtor's space and confirm its
    # brokerageId matches the caller's. Empty data = treat as forbidden:
    # we don't want a leak signal that "this user exists but isn't in your
    # brokerage."
    space_res = await (
        db.table("Space")
        .select("id,ownerId,brokerageId,name")
        .eq("ownerId", realtor_id)
        .maybe_single()
        .execute()
    )
    if not space_res.data or space_res.data.get("brokerageId") != brokerage_id:
        raise BrokerPermissionError(
            "That realtor isn't in your brokerage."
        )
    space_id = space_res.data["id"]

    user_res = await (
        db.table("User")
        .select("id,name,email,createdAt")
        .eq("id", realtor_id)
        .maybe_single()
        .execute()
    )
    if not user_res.data:
        # Space exists but the User row is gone — return an empty-but-ok
        # envelope so the agent reports plainly instead of looping.
        return {
            "ok": True,
            "realtor": {"id": realtor_id, "name": "Realtor", "joinedAt": None},
            "deals_by_stage": {},
            "deals_by_status": {},
            "conversion_pct": None,
            "gci_ytd": 0.0,
            "active_leads": 0,
            "avg_response_hours_7d": None,
            "last_activity_at": None,
            "won_in_last_30d": 0,
        }
    user = user_res.data

    now = datetime.now(timezone.utc)
    ytd_start = datetime(now.year, 1, 1, tzinfo=timezone.utc)
    cutoff_7d = now - timedelta(days=_RESPONSE_WINDOW_DAYS)
    cutoff_30d = now - timedelta(days=30)

    # Stage map for human-readable bucketing.
    stages_res = await (
        db.table("DealStage")
        .select("id,name")
        .eq("spaceId", space_id)
        .execute()
    )
    stage_name_by_id: dict[str, str] = {
        s["id"]: s["name"] for s in (stages_res.data or [])
    }

    # All deals for this realtor — small enough to roll up in Python.
    deals_res = await (
        db.table("Deal")
        .select("id,stageId,status,value,commissionRate,updatedAt")
        .eq("spaceId", space_id)
        .limit(5000)
        .execute()
    )
    deals = deals_res.data or []

    deals_by_stage: dict[str, int] = {}
    deals_by_status: dict[str, int] = {"active": 0, "won": 0, "lost": 0, "on_hold": 0}
    gci_ytd = 0.0
    won_in_last_30d = 0
    for d in deals:
        status = d.get("status") or "active"
        if status in deals_by_status:
            deals_by_status[status] += 1
        stage_name = stage_name_by_id.get(d.get("stageId") or "", "(unstaged)")
        deals_by_stage[stage_name] = deals_by_stage.get(stage_name, 0) + 1

        if status == "won":
            updated = _parse_iso(d.get("updatedAt"))
            value = d.get("value")
            rate = d.get("commissionRate")
            if updated and updated >= ytd_start and value is not None and rate is not None:
                gci_ytd += float(value) * float(rate) / 100.0
            if updated and updated >= cutoff_30d:
                won_in_last_30d += 1

    # Conversion = won / (won + lost + active).
    won = deals_by_status["won"]
    lost = deals_by_status["lost"]
    active = deals_by_status["active"]
    denom = won + lost + active
    conversion_pct = round(won / denom, 4) if denom > 0 else None

    # Active leads — Contact rows in the QUALIFICATION stage.
    leads_res = await (
        db.table("Contact")
        .select("id")
        .eq("spaceId", space_id)
        .eq("type", "QUALIFICATION")
        .limit(5000)
        .execute()
    )
    active_leads = len(leads_res.data or [])

    # Response speed + last activity, same helpers as team_health.
    hours = await _response_hours_for_space(space_id, cutoff_7d, now)
    avg_response = round(statistics.mean(hours), 2) if hours else None
    last_activity = await _last_active_at(space_id)

    return {
        "ok": True,
        "realtor": {
            "id": user["id"],
            "name": user.get("name") or user.get("email") or "Realtor",
            "joinedAt": user.get("createdAt").isoformat()
                if isinstance(user.get("createdAt"), datetime)
                else user.get("createdAt"),
        },
        "deals_by_stage": deals_by_stage,
        "deals_by_status": deals_by_status,
        "conversion_pct": conversion_pct,
        "gci_ytd": round(gci_ytd, 2),
        "active_leads": active_leads,
        "avg_response_hours_7d": avg_response,
        "last_activity_at": last_activity.isoformat() if last_activity else None,
        "won_in_last_30d": won_in_last_30d,
    }


@function_tool(strict_mode=False)
async def read_realtor_morning_story(
    ctx: RunContextWrapper[AgentContext],
    realtor_id: str,
) -> dict[str, Any]:
    """Mirror the realtor's /chippi morning briefing; counts + named subjects only."""
    # PII-safe: surface (counts/names/ids) only, never private notes/DMs/threads.
    # Cross-brokerage drill raises BrokerPermissionError.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()

    # Cross-brokerage guard — same pattern as realtor_performance.
    space_res = await (
        db.table("Space")
        .select("id,ownerId,brokerageId")
        .eq("ownerId", realtor_id)
        .maybe_single()
        .execute()
    )
    if not space_res.data or space_res.data.get("brokerageId") != brokerage_id:
        raise BrokerPermissionError(
            "That realtor isn't in your brokerage."
        )
    space_id = space_res.data["id"]

    user_res = await (
        db.table("User")
        .select("id,name,email")
        .eq("id", realtor_id)
        .maybe_single()
        .execute()
    )
    user = user_res.data or {"id": realtor_id, "name": "Realtor"}
    realtor_name = user.get("name") or user.get("email") or "Realtor"

    now = datetime.now(timezone.utc)
    week_out = now + timedelta(days=7)

    # ── Counts (mirroring /api/agent/morning shape) ─────────────────────
    # The realtor-side route excludes brokerage-routed leads. We mirror
    # that filter so the broker sees what's actually on the realtor's
    # personal desk, not aggregate brokerage flow.
    new_people_res = await (
        db.table("Contact")
        .select("id,name,createdAt")
        .eq("spaceId", space_id)
        .is_("brokerageId", None)
        .order("createdAt", desc=True)
        .limit(500)
        .execute()
    )
    contacts = new_people_res.data or []
    new_people = [c for c in contacts if "new-lead" in (c.get("tags") or [])]
    # tags column wasn't selected — pull it on a tighter query so we don't
    # bloat the previous one.
    tags_res = await (
        db.table("Contact")
        .select("id,name,tags,leadScore,followUpAt,createdAt")
        .eq("spaceId", space_id)
        .is_("brokerageId", None)
        .limit(2000)
        .execute()
    )
    rows = tags_res.data or []

    new_people_rows = [
        c for c in rows if "new-lead" in (c.get("tags") or [])
    ]
    new_people_count = len(new_people_rows)
    top_new_person = None
    if new_people_rows:
        # Most recent createdAt.
        most_recent = max(
            new_people_rows,
            key=lambda c: _parse_iso(c.get("createdAt")) or datetime.min.replace(tzinfo=timezone.utc),
        )
        top_new_person = {"id": most_recent["id"], "name": most_recent.get("name") or "Lead"}

    # Hot leads: leadScore >= 70 (HOT_LEAD_THRESHOLD in lib/constants.ts).
    hot_rows = [c for c in rows if (c.get("leadScore") or 0) >= 70]
    hot_people_count = len(hot_rows)
    top_hot_person = None
    if hot_rows:
        hottest = max(hot_rows, key=lambda c: c.get("leadScore") or 0)
        top_hot_person = {"id": hottest["id"], "name": hottest.get("name") or "Lead"}

    # Overdue follow-ups.
    overdue_rows: list[dict[str, Any]] = []
    for c in rows:
        fu = _parse_iso(c.get("followUpAt"))
        if fu and fu < now:
            overdue_rows.append({**c, "_fu": fu})
    overdue_followups_count = len(overdue_rows)
    top_overdue_follow_up = None
    if overdue_rows:
        most_overdue = min(overdue_rows, key=lambda c: c["_fu"])
        days = max(0, (now - most_overdue["_fu"]).days)
        top_overdue_follow_up = {
            "id": most_overdue["id"],
            "name": most_overdue.get("name") or "Lead",
            "daysOverdue": days,
        }

    # Stuck + closing-this-week deals — heuristic mirrors lib/deals/health.ts
    # but simplified to the active+stale signal: status='active' AND
    # updatedAt > 30 days ago counts as stuck. The realtor route uses the
    # full dealHealth() classifier; we approximate here because porting that
    # classifier to Python is Phase-4 surface work.
    deals_res = await (
        db.table("Deal")
        .select("id,title,updatedAt,closeDate,status")
        .eq("spaceId", space_id)
        .eq("status", "active")
        .limit(2000)
        .execute()
    )
    active_deals = deals_res.data or []
    stuck_threshold = timedelta(days=30)
    stuck_rows: list[dict[str, Any]] = []
    closing_this_week_count = 0
    for d in active_deals:
        updated = _parse_iso(d.get("updatedAt"))
        if updated and (now - updated) >= stuck_threshold:
            stuck_rows.append({**d, "_updated": updated})
        close = _parse_iso(d.get("closeDate"))
        if close and now <= close <= week_out:
            closing_this_week_count += 1
    stuck_deals_count = len(stuck_rows)
    top_stuck_deal = None
    if stuck_rows:
        longest = min(stuck_rows, key=lambda d: d["_updated"])
        days = max(0, (now - longest["_updated"]).days)
        top_stuck_deal = {
            "id": longest["id"],
            "title": longest.get("title") or "Deal",
            "daysStuck": days,
        }

    # Pending drafts + questions — the agentic-runtime side of the home.
    drafts_res = await (
        db.table("AgentDraft")
        .select("id")
        .eq("spaceId", space_id)
        .eq("status", "pending")
        .limit(500)
        .execute()
    )
    drafts_count = len(drafts_res.data or [])

    # AgentQuestion may not exist in every deploy — wrap in try and report
    # zero if the table is absent so the tool doesn't fail the chat turn.
    questions_count = 0
    try:
        q_res = await (
            db.table("AgentQuestion")
            .select("id")
            .eq("spaceId", space_id)
            .eq("status", "pending")
            .limit(500)
            .execute()
        )
        questions_count = len(q_res.data or [])
    except Exception:
        questions_count = 0

    return {
        "ok": True,
        "realtor": {"id": realtor_id, "name": realtor_name},
        "morning_story": {
            "newPeopleCount": new_people_count,
            "hotPeopleCount": hot_people_count,
            "overdueFollowUpsCount": overdue_followups_count,
            "stuckDealsCount": stuck_deals_count,
            "closingThisWeekCount": closing_this_week_count,
            "draftsCount": drafts_count,
            "questionsCount": questions_count,
            "topStuckDeal": top_stuck_deal,
            "topOverdueFollowUp": top_overdue_follow_up,
            "topNewPerson": top_new_person,
            "topHotPerson": top_hot_person,
        },
    }


# Module-level list — `__init__.py` extends BROKER_TOOLS from this.
TEAM_TOOLS: list = [team_health, realtor_performance, read_realtor_morning_story]


__all__ = [
    "team_health",
    "realtor_performance",
    "read_realtor_morning_story",
    "TEAM_TOOLS",
]
