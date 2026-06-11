"""Broker read tools — commission revenue across the brokerage.

One tool: commission_report(period). Sums GCI by realtor for a chosen window
and returns the brokerage total. GCI = value * commissionRate / 100, same
formula as `lib/commissions.ts` (verified read).

Deal has no dedicated `closedAt` column — wins are recognised by the
`status='won'` row paired with `updatedAt` (which is when the status moved
to won, the same proxy `/api/broker/morning` uses for won-this-week
counting). Phase 3 may introduce `closedAt` properly; for now this matches
the in-product convention.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from agents import RunContextWrapper, function_tool

from db import supabase
from security.context import AgentContext

from ._guards import require_broker_role


PeriodLiteral = Literal["mtd", "ytd", "last_30d"]


def _period_start(period: str, now: datetime) -> datetime:
    """Resolve the start datetime for the chosen period.

    mtd       — first day of the current month, 00:00 UTC.
    ytd       — January 1 of the current year, 00:00 UTC.
    last_30d  — exactly 30 days before `now`.

    Any other value falls back to mtd; we don't error on unknown periods
    so the agent can keep moving when the model emits an off-spec value.
    """
    p = (period or "mtd").lower()
    if p == "ytd":
        return datetime(now.year, 1, 1, tzinfo=timezone.utc)
    if p == "last_30d":
        return now - timedelta(days=30)
    # mtd (default)
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


@function_tool(strict_mode=False)
async def commission_report(
    ctx: RunContextWrapper[AgentContext],
    period: str = "mtd",
) -> dict[str, Any]:
    """Commission revenue across the brokerage, broken out by realtor + total."""
    # period: 'mtd' (default) | 'ytd' | 'last_30d'; unknown values fall back to mtd.
    # GCI = value * commissionRate / 100 over status='won' with updatedAt in window.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()
    now = datetime.now(timezone.utc)
    start = _period_start(period, now)
    normalised_period = period.lower() if period and period.lower() in {"mtd", "ytd", "last_30d"} else "mtd"

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
            "period": normalised_period,
            "by_realtor": [],
            "brokerage_total": 0.0,
        }

    space_to_owner: dict[str, str] = {
        s["id"]: s.get("ownerId") for s in spaces if s.get("id") and s.get("ownerId")
    }
    space_ids = list(space_to_owner.keys())

    deals_res = await (
        db.table("Deal")
        .select("id,spaceId,value,commissionRate,status,updatedAt")
        .in_("spaceId", space_ids)
        .eq("status", "won")
        .gte("updatedAt", start)
        .limit(10000)
        .execute()
    )
    deals = deals_res.data or []

    owner_ids = list(set(space_to_owner.values()))
    users_by_id: dict[str, dict[str, Any]] = {}
    if owner_ids:
        users_res = await (
            db.table("User")
            .select("id,name,email")
            .in_("id", owner_ids)
            .execute()
        )
        users_by_id = {u["id"]: u for u in (users_res.data or [])}

    # Aggregate per realtor (one row per space owner, even if the realtor
    # has zero wins in the window — calm chief-of-staff reporting needs
    # the full team list so the broker can see who has nothing on the board).
    rollup: dict[str, dict[str, Any]] = {}
    for owner_id in owner_ids:
        u = users_by_id.get(owner_id) or {}
        rollup[owner_id] = {
            "id": owner_id,
            "name": u.get("name") or u.get("email") or "Realtor",
            "deals_closed": 0,
            "gci_earned": 0.0,
        }

    total = 0.0
    for d in deals:
        owner_id = space_to_owner.get(d.get("spaceId") or "")
        if not owner_id:
            continue
        bucket = rollup.get(owner_id)
        if not bucket:
            continue
        bucket["deals_closed"] += 1
        value = d.get("value")
        rate = d.get("commissionRate")
        if value is not None and rate is not None:
            gci = float(value) * float(rate) / 100.0
            bucket["gci_earned"] += gci
            total += gci

    # Round at the end so we don't accumulate float error in the loop.
    by_realtor = []
    for bucket in rollup.values():
        by_realtor.append({
            "id": bucket["id"],
            "name": bucket["name"],
            "deals_closed": bucket["deals_closed"],
            "gci_earned": round(bucket["gci_earned"], 2),
        })
    by_realtor.sort(key=lambda r: r["gci_earned"], reverse=True)

    return {
        "ok": True,
        "period": normalised_period,
        "by_realtor": by_realtor,
        "brokerage_total": round(total, 2),
    }


REVENUE_TOOLS: list = [commission_report]


__all__ = ["commission_report", "REVENUE_TOOLS"]
