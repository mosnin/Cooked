"""Broker read tools — response-time benchmarking across the team.

Two tools live here because they both answer "how is the team performing?":

  audit_response_times()      — per-realtor median first-touch response time
                                over 30d, banded vs team median (fast /
                                on_pace / slow / no_data).
  find_at_risk_agents()       — flight-risk signals per realtor: won-deal
                                trend (this 30d vs prior 30d), days since last
                                activity, un-worked assigned leads, and SLA-tag
                                counts (sla-nudged / sla-escalated). Returns a
                                ranked at-risk list + a plain-English summary.

The classification is intentionally band-based, not absolute. The chief-of-
staff voice (see `agent/chippi_broker.py:BROKER_INSTRUCTIONS`) frames every
realtor's number against the team benchmark — never as a judgment. "Alice's
median is 28h vs team median 6h" is OK. "Alice is slow" is not.

Definition of "outbound" matches the rest of the broker side: ContactActivity
rows of type 'call', 'email', or 'meeting'. Type 'note' / 'follow_up' are
private memory, not contact with the human.
"""

from __future__ import annotations

import asyncio
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from agents import RunContextWrapper, function_tool

from db import supabase
from security.context import AgentContext

from ._guards import require_broker_role


# Outbound activity types — single source of truth here so team.py and
# performance.py can't drift apart. (They define their own _OUTBOUND_TYPES
# for the same reason — co-locating tuples next to the queries that use them
# beats a shared "constants.py" no-one finds.)
_OUTBOUND_TYPES: tuple[str, ...] = ("call", "email", "meeting")

# Window for the median calc. Contacts created in this window are the only
# ones we compute response speed for — older contacts may have legitimate
# long-tail nurture cycles that aren't "response speed."
_WINDOW_DAYS = 30


# Band multipliers against the team median:
#   fast:    median ≤ team_median × 0.5
#   slow:    median ≥ team_median × 2.0
#   on_pace: anything in between
# Picked deliberately wide so the bands only catch real outliers.
_FAST_MULTIPLIER = 0.5
_SLOW_MULTIPLIER = 2.0


@function_tool(strict_mode=False)
async def audit_response_times(
    ctx: RunContextWrapper[AgentContext],
) -> dict[str, Any]:
    """Per-realtor median first-touch response time over 30d, banded vs team median."""
    # Bands relative to team_median: fast (<=0.5x), on_pace (mid), slow (>=2x).
    # Realtors with no outbound in window surface as no_data, not slow.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=_WINDOW_DAYS)

    spaces_res = await (
        db.table("Space")
        .select("id,ownerId,name")
        .eq("brokerageId", brokerage_id)
        .execute()
    )
    spaces = spaces_res.data or []
    if not spaces:
        return {
            "ok": True,
            "team_median_hours": None,
            "fast": [],
            "slow": [],
            "on_pace": [],
            "no_data": [],
        }

    owner_ids = [s["ownerId"] for s in spaces if s.get("ownerId")]
    users_res = await (
        db.table("User")
        .select("id,name,email")
        .in_("id", owner_ids)
        .execute()
    ) if owner_ids else None
    users_by_id = {u["id"]: u for u in ((users_res.data if users_res else []) or [])}

    # Per-realtor audit as a coroutine — the roster runs in PARALLEL via
    # asyncio.gather instead of 2 sequential DB round-trips per realtor.
    async def _audit(space: dict[str, Any]) -> tuple[dict[str, Any], list[float]] | None:
        space_id = space["id"]
        owner_id = space.get("ownerId")
        if not owner_id:
            return None
        user = users_by_id.get(owner_id) or {}
        name = user.get("name") or user.get("email") or "Realtor"

        # Contacts created in the window.
        contacts_res = await (
            db.table("Contact")
            .select("id,createdAt")
            .eq("spaceId", space_id)
            .gte("createdAt", since)
            .limit(2000)
            .execute()
        )
        contacts = contacts_res.data or []
        if not contacts:
            return ({
                "id": owner_id,
                "name": name,
                "median_hours": None,
                "sample_size": 0,
            }, [])

        contact_ids = [c["id"] for c in contacts if c.get("id")]
        if not contact_ids:
            return ({
                "id": owner_id,
                "name": name,
                "median_hours": None,
                "sample_size": 0,
            }, [])

        # First outbound activity per contact — same shape as
        # team._response_hours_for_space, duplicated here so neither module
        # imports the other's private helper. (Single source of truth via
        # a shared module would be nice, but the realtor tools follow the
        # same pattern: a little duplication beats a tangle.)
        acts_res = await (
            db.table("ContactActivity")
            .select("contactId,createdAt")
            .in_("contactId", contact_ids)
            .in_("type", list(_OUTBOUND_TYPES))
            .execute()
        )
        acts = acts_res.data or []
        first_outbound: dict[str, datetime] = {}
        for a in acts:
            cid = a.get("contactId")
            ts = a.get("createdAt")
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except ValueError:
                    continue
            if not isinstance(ts, datetime):
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            prev = first_outbound.get(cid or "")
            if prev is None or ts < prev:
                first_outbound[cid or ""] = ts

        hours: list[float] = []
        for c in contacts:
            cid = c.get("id")
            created = c.get("createdAt")
            if isinstance(created, str):
                try:
                    created = datetime.fromisoformat(created.replace("Z", "+00:00"))
                except ValueError:
                    continue
            if not isinstance(created, datetime):
                continue
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            first = first_outbound.get(cid or "")
            if not first:
                continue
            delta = (first - created).total_seconds() / 3600.0
            if delta < 0:
                continue
            hours.append(round(delta, 2))

        if hours:
            med = round(statistics.median(hours), 2)
            return ({
                "id": owner_id,
                "name": name,
                "median_hours": med,
                "sample_size": len(hours),
            }, hours)
        return ({
            "id": owner_id,
            "name": name,
            "median_hours": None,
            "sample_size": 0,
        }, [])

    audited = await asyncio.gather(*(_audit(s) for s in spaces))
    per_realtor: list[dict[str, Any]] = [r[0] for r in audited if r is not None]
    all_hours: list[float] = [h for r in audited if r is not None for h in r[1]]

    # Team median across ALL response samples (not the median of medians —
    # the broker wants the team's "typical" response, which is best measured
    # on raw samples).
    team_median = round(statistics.median(all_hours), 2) if all_hours else None

    fast: list[dict[str, Any]] = []
    slow: list[dict[str, Any]] = []
    on_pace: list[dict[str, Any]] = []
    no_data: list[dict[str, Any]] = []

    if team_median is None:
        # No outbound across the brokerage — return everyone in no_data.
        for r in per_realtor:
            no_data.append({"id": r["id"], "name": r["name"]})
        return {
            "ok": True,
            "team_median_hours": None,
            "fast": fast,
            "slow": slow,
            "on_pace": on_pace,
            "no_data": no_data,
        }

    fast_threshold = team_median * _FAST_MULTIPLIER
    slow_threshold = team_median * _SLOW_MULTIPLIER
    for r in per_realtor:
        med = r["median_hours"]
        if med is None:
            no_data.append({"id": r["id"], "name": r["name"]})
        elif med <= fast_threshold:
            fast.append({"id": r["id"], "name": r["name"], "median_hours": med})
        elif med >= slow_threshold:
            slow.append({"id": r["id"], "name": r["name"], "median_hours": med})
        else:
            on_pace.append({"id": r["id"], "name": r["name"], "median_hours": med})

    return {
        "ok": True,
        "team_median_hours": team_median,
        "fast": fast,
        "slow": slow,
        "on_pace": on_pace,
        "no_data": no_data,
    }


# ── Flight-risk / at-risk agent detection ──────────────────────────────────

# How many days back each "period" covers for the won-deal trend comparison.
_RISK_PERIOD_DAYS = 30

# Silence threshold: if a realtor has had no activity (Contact or Deal
# createdAt/updatedAt) for this many days, they surface as "going quiet".
_QUIET_DAYS_THRESHOLD = 14

# SLA tag names — must match the tags written by the SLA engine.
_SLA_NUDGE_TAG = "sla-nudged"
_SLA_ESCALATE_TAG = "sla-escalated"

# Tag written by the broker assignment flow (same as find_breached_leads).
_ASSIGNED_BY_BROKER_TAG = "assigned-by-broker"


@function_tool(strict_mode=False)
async def find_at_risk_agents(
    ctx: RunContextWrapper[AgentContext],
) -> dict[str, Any]:
    """Flight-risk signals per realtor: won-deal trend, silence days, un-worked leads, SLA hits."""
    # Signals per realtor:
    #   1. won_this_period / won_prior_period — deals with status='won' in each 30d window.
    #   2. days_since_last_activity — max(Contact.createdAt, Deal.updatedAt) across the space.
    #   3. unworked_assigned_leads — 'assigned-by-broker' contacts with lastContactedAt IS NULL.
    #   4. sla_nudge_count / sla_escalate_count — contacts carrying the SLA tags.
    # Realtors with ≥1 signal surface in the at_risk list, sorted by signal severity.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()
    now = datetime.now(timezone.utc)
    period_start = now - timedelta(days=_RISK_PERIOD_DAYS)
    prior_start = now - timedelta(days=_RISK_PERIOD_DAYS * 2)

    # ── 1. Resolve member spaces ────────────────────────────────────────────
    spaces_res = await (
        db.table("Space")
        .select("id,ownerId,name")
        .eq("brokerageId", brokerage_id)
        .execute()
    )
    spaces = spaces_res.data or []
    if not spaces:
        return {
            "ok": True,
            "at_risk": [],
            "summary": "No member spaces found for this brokerage.",
        }

    owner_ids = [s["ownerId"] for s in spaces if s.get("ownerId")]
    users_by_id: dict[str, dict[str, Any]] = {}
    if owner_ids:
        users_res = await (
            db.table("User")
            .select("id,name,email")
            .in_("id", owner_ids)
            .execute()
        )
        users_by_id = {u["id"]: u for u in (users_res.data or [])}

    # Per-realtor assessment as a coroutine so the whole roster runs in
    # PARALLEL via asyncio.gather. The sequential version paid ~6 DB
    # round-trips per realtor in series — 120 sequential queries for a
    # 20-agent brokerage, the dominant term in "broker chat is slow".
    async def _assess(space: dict[str, Any]) -> dict[str, Any] | None:
        space_id = space["id"]
        owner_id = space.get("ownerId")
        if not owner_id:
            return None
        user = users_by_id.get(owner_id) or {}
        name = user.get("name") or user.get("email") or "Realtor"

        # ── 2. Won-deal trend: this period vs prior period ──────────────────
        # This period: status='won', updatedAt in [period_start, now]
        won_this_res = await (
            db.table("Deal")
            .select("id")
            .eq("spaceId", space_id)
            .eq("status", "won")
            .gte("updatedAt", period_start)
            .lte("updatedAt", now)
            .limit(2000)
            .execute()
        )
        won_this = len(won_this_res.data or [])

        # Prior period: status='won', updatedAt in [prior_start, period_start)
        won_prior_res = await (
            db.table("Deal")
            .select("id")
            .eq("spaceId", space_id)
            .eq("status", "won")
            .gte("updatedAt", prior_start)
            .lte("updatedAt", period_start)
            .limit(2000)
            .execute()
        )
        won_prior = len(won_prior_res.data or [])

        # ── 3. Days since last activity ─────────────────────────────────────
        # Most recent Contact created in this space.
        last_contact_res = await (
            db.table("Contact")
            .select("createdAt")
            .eq("spaceId", space_id)
            .order("createdAt", desc=True)
            .limit(1)
            .execute()
        )
        last_contact_rows = last_contact_res.data or []

        # Most recent Deal touched in this space.
        last_deal_res = await (
            db.table("Deal")
            .select("updatedAt")
            .eq("spaceId", space_id)
            .order("updatedAt", desc=True)
            .limit(1)
            .execute()
        )
        last_deal_rows = last_deal_res.data or []

        # Parse and compare; take the most recent of the two.
        def _parse_ts(raw: Any) -> datetime | None:
            if isinstance(raw, datetime):
                return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
            if isinstance(raw, str):
                try:
                    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
                except ValueError:
                    return None
            return None

        candidates: list[datetime] = []
        if last_contact_rows:
            ts = _parse_ts(last_contact_rows[0].get("createdAt"))
            if ts:
                candidates.append(ts)
        if last_deal_rows:
            ts = _parse_ts(last_deal_rows[0].get("updatedAt"))
            if ts:
                candidates.append(ts)

        last_activity: datetime | None = max(candidates) if candidates else None
        days_quiet: int | None = (
            (now - last_activity).days if last_activity is not None else None
        )

        # ── 4. Un-worked assigned leads ─────────────────────────────────────
        # Over-fetch and filter in Python; same pattern as find_breached_leads.
        unworked_res = await (
            db.table("Contact")
            .select("id,tags")
            .eq("spaceId", space_id)
            .is_("lastContactedAt", None)
            .limit(2000)
            .execute()
        )
        unworked_count = sum(
            1
            for c in (unworked_res.data or [])
            if _ASSIGNED_BY_BROKER_TAG in (c.get("tags") or [])
        )

        # ── 5. SLA tag counts ───────────────────────────────────────────────
        sla_res = await (
            db.table("Contact")
            .select("id,tags")
            .eq("spaceId", space_id)
            .limit(5000)
            .execute()
        )
        sla_nudge_count = 0
        sla_escalate_count = 0
        for c in (sla_res.data or []):
            tags = c.get("tags") or []
            if _SLA_NUDGE_TAG in tags:
                sla_nudge_count += 1
            if _SLA_ESCALATE_TAG in tags:
                sla_escalate_count += 1

        # ── 6. Evaluate risk signals ────────────────────────────────────────
        reasons: list[str] = []

        # Won-deal decline: prior > 0 and this period is lower.
        won_pct_change: float | None = None
        if won_prior > 0 and won_this < won_prior:
            won_pct_change = round((won_this - won_prior) / won_prior * 100, 1)
            reasons.append(
                f"won deals down {abs(won_pct_change):.0f}% "
                f"({won_this} this 30d vs {won_prior} prior 30d)"
            )
        elif won_prior == 0 and won_this == 0:
            # No wins in either period — flag as a weaker signal (no output).
            pass

        if days_quiet is not None and days_quiet >= _QUIET_DAYS_THRESHOLD:
            reasons.append(f"quiet for {days_quiet} day{'s' if days_quiet != 1 else ''}")

        if unworked_count > 0:
            reasons.append(
                f"{unworked_count} assigned lead{'s' if unworked_count != 1 else ''} "
                "never contacted"
            )

        if sla_escalate_count > 0:
            reasons.append(f"{sla_escalate_count} lead{'s' if sla_escalate_count != 1 else ''} past escalation SLA")
        elif sla_nudge_count > 0:
            reasons.append(f"{sla_nudge_count} SLA nudge{'s' if sla_nudge_count != 1 else ''}")

        if not reasons:
            return None  # no signals — realtor is fine

        # Risk score: escalated leads are heaviest, then silence, then won decline.
        risk_score = (
            sla_escalate_count * 10
            + (days_quiet or 0)
            + unworked_count * 3
            + (abs(won_pct_change) if won_pct_change is not None else 0)
        )

        return {
            "id": owner_id,
            "name": name,
            "risk_score": round(risk_score, 1),
            "reasons": reasons,
            "metrics": {
                "won_this_period": won_this,
                "won_prior_period": won_prior,
                "won_pct_change": won_pct_change,
                "days_since_last_activity": days_quiet,
                "unworked_assigned_leads": unworked_count,
                "sla_nudge_count": sla_nudge_count,
                "sla_escalate_count": sla_escalate_count,
            },
        }

    results = await asyncio.gather(*(_assess(s) for s in spaces))
    at_risk: list[dict[str, Any]] = [r for r in results if r is not None]

    # Sort descending by risk_score so the most urgent surfaces first.
    at_risk.sort(key=lambda r: r["risk_score"], reverse=True)

    # ── 7. Summary sentence ─────────────────────────────────────────────────
    if not at_risk:
        summary = "No agents are showing flight-risk signals right now — team looks engaged."
    else:
        top = at_risk[0]
        top_reasons = "; ".join(top["reasons"])
        summary = (
            f"{len(at_risk)} agent{'s' if len(at_risk) != 1 else ''} showing "
            f"flight-risk signals; {top['name']} has the strongest "
            f"({top_reasons})."
        )

    return {
        "ok": True,
        "at_risk": at_risk,
        "summary": summary,
    }


PERFORMANCE_TOOLS: list = [audit_response_times, find_at_risk_agents]


__all__ = ["audit_response_times", "find_at_risk_agents", "PERFORMANCE_TOOLS"]
