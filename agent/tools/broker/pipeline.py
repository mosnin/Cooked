"""Broker read tools — pipeline pressure points.

Two tools live here because they both answer "where's the team losing
momentum?":

  find_stuck_deals(min_days)         — active deals across the brokerage that
                                       haven't been touched in `min_days`+
                                       days, ranked by age × value so the
                                       biggest stuck deals surface first.
  find_unassigned_leads(min_hours)   — brokerage-intake leads sitting in the
                                       queue without a realtor on them, with
                                       a proposed routing target picked by
                                       lightest current load.
  find_breached_leads()              — routed leads (tag: assigned-by-broker)
                                       that have never been contacted
                                       (lastContactedAt IS NULL) and are past
                                       the brokerage's slaFirstResponseMinutes
                                       clock; flags any already past
                                       slaEscalateMinutes too.

Both are brokerage-scoped through `Space WHERE brokerageId = ctx.brokerage_id`
and gated by `require_broker_role(ctx)`. Phase 3 will add the matching write
tools (assign_lead, ping_realtor_on_stuck_deal); for now these are read-only
surface — the broker still does the actual move themselves.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from agents import RunContextWrapper, function_tool

from db import supabase
from security.context import AgentContext

from ._guards import require_broker_role


# Cap on returned rows — the broker chat needs the top N, not the full list.
_STUCK_DEAL_LIMIT = 20
_UNASSIGNED_LEAD_LIMIT = 50
_BREACHED_LEAD_LIMIT = 50

# Default SLA window when the brokerage row has no value set.
_DEFAULT_SLA_FIRST_RESPONSE_MINUTES = 60


@function_tool(strict_mode=False)
async def find_stuck_deals(
    ctx: RunContextWrapper[AgentContext],
    min_days: int = 7,
) -> dict[str, Any]:
    """Find active deals across the brokerage stalled min_days+, ranked by days*value."""
    # Stuck = status='active' AND updatedAt older than min_days. Returns top 20.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max(1, min_days))

    # Resolve the brokerage's spaces in one query — we filter Deal on
    # spaceId IN (...) instead of joining through Space at the SQL layer.
    # The QueryBuilder shim doesn't do joins; explicit two-step is fine.
    spaces_res = await (
        db.table("Space")
        .select("id,ownerId,name")
        .eq("brokerageId", brokerage_id)
        .execute()
    )
    spaces = spaces_res.data or []
    if not spaces:
        return {"ok": True, "stuck_deals": []}

    space_to_owner: dict[str, str] = {s["id"]: s.get("ownerId") for s in spaces if s.get("id")}
    space_ids = list(space_to_owner.keys())

    deals_res = await (
        db.table("Deal")
        .select("id,title,value,stageId,spaceId,status,updatedAt")
        .in_("spaceId", space_ids)
        .eq("status", "active")
        .lte("updatedAt", cutoff)
        .limit(5000)
        .execute()
    )
    deals = deals_res.data or []
    if not deals:
        return {"ok": True, "stuck_deals": []}

    # Resolve stage names for human-readable output.
    stage_ids = list({d.get("stageId") for d in deals if d.get("stageId")})
    stage_name_by_id: dict[str, str] = {}
    if stage_ids:
        stages_res = await (
            db.table("DealStage")
            .select("id,name")
            .in_("id", stage_ids)
            .execute()
        )
        stage_name_by_id = {s["id"]: s["name"] for s in (stages_res.data or [])}

    # Resolve realtor names for the assigned_to field.
    owner_ids = list({oid for oid in space_to_owner.values() if oid})
    users_by_id: dict[str, dict[str, Any]] = {}
    if owner_ids:
        users_res = await (
            db.table("User")
            .select("id,name,email")
            .in_("id", owner_ids)
            .execute()
        )
        users_by_id = {u["id"]: u for u in (users_res.data or [])}

    # Build + score.
    scored: list[dict[str, Any]] = []
    for d in deals:
        updated = d.get("updatedAt")
        if isinstance(updated, str):
            try:
                updated_dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            except ValueError:
                continue
        elif isinstance(updated, datetime):
            updated_dt = updated if updated.tzinfo else updated.replace(tzinfo=timezone.utc)
        else:
            continue
        if updated_dt.tzinfo is None:
            updated_dt = updated_dt.replace(tzinfo=timezone.utc)
        days_since = max(0, (now - updated_dt).days)
        value = float(d.get("value") or 0)
        score = days_since * value

        owner_id = space_to_owner.get(d.get("spaceId") or "")
        owner = users_by_id.get(owner_id) if owner_id else None
        scored.append({
            "id": d["id"],
            "title": d.get("title") or "Deal",
            "value": value,
            "stage": stage_name_by_id.get(d.get("stageId") or "", "(unstaged)"),
            "days_since_activity": days_since,
            "assigned_to": {
                "id": owner_id or "",
                "name": (owner or {}).get("name") or (owner or {}).get("email") or "Realtor",
            } if owner_id else None,
            "score": round(score, 2),
        })

    scored.sort(key=lambda r: r["score"], reverse=True)
    return {"ok": True, "stuck_deals": scored[:_STUCK_DEAL_LIMIT]}


@function_tool(strict_mode=False)
async def find_unassigned_leads(
    ctx: RunContextWrapper[AgentContext],
    min_hours: int = 2,
) -> dict[str, Any]:
    """Find unassigned brokerage-intake leads, with the lightest-load realtor proposed."""
    # Unassigned = Contact in this brokerage tagged 'brokerage-lead', not 'assigned', older than min_hours.
    # proposed_routing picks min(open_load=active_deals+open_leads); reason includes team median.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=max(0, min_hours))

    # Unassigned leads — same predicates as app/broker/leads/page.tsx.
    leads_res = await (
        db.table("Contact")
        .select("id,name,email,leadType,leadScore,scoreLabel,tags,createdAt")
        .eq("brokerageId", brokerage_id)
        .lte("createdAt", cutoff)
        .order("createdAt", desc=False)
        .limit(_UNASSIGNED_LEAD_LIMIT * 2)  # over-fetch; filter tags in Python
        .execute()
    )
    raw_leads = leads_res.data or []
    unassigned = [
        c for c in raw_leads
        if "brokerage-lead" in (c.get("tags") or [])
        and "assigned" not in (c.get("tags") or [])
    ][:_UNASSIGNED_LEAD_LIMIT]

    if not unassigned:
        return {
            "ok": True,
            "unassigned_leads": [],
            "proposed_routing": [],
        }

    # Compute open_load per realtor — duplicate of team_health's logic so
    # this tool doesn't recursively invoke another @function_tool (Agents
    # SDK isn't built for that and the run_id would collide).
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
            "unassigned_leads": unassigned,
            "proposed_routing": [],
        }

    user_ids = [s["ownerId"] for s in spaces if s.get("ownerId")]
    users_res = await (
        db.table("User")
        .select("id,name,email")
        .in_("id", user_ids)
        .execute()
    ) if user_ids else None
    users_by_id = {u["id"]: u for u in ((users_res.data if users_res else []) or [])}

    realtor_loads: list[dict[str, Any]] = []
    for space in spaces:
        space_id = space["id"]
        owner_id = space.get("ownerId")
        if not owner_id:
            continue

        active_deals_res = await (
            db.table("Deal")
            .select("id")
            .eq("spaceId", space_id)
            .eq("status", "active")
            .limit(2000)
            .execute()
        )
        active_deals = len(active_deals_res.data or [])
        leads_res2 = await (
            db.table("Contact")
            .select("id")
            .eq("spaceId", space_id)
            .eq("type", "QUALIFICATION")
            .limit(2000)
            .execute()
        )
        open_leads = len(leads_res2.data or [])
        user = users_by_id.get(owner_id)
        realtor_loads.append({
            "id": owner_id,
            "name": (user or {}).get("name") or (user or {}).get("email") or "Realtor",
            "open_load": active_deals + open_leads,
        })

    if not realtor_loads:
        return {
            "ok": True,
            "unassigned_leads": unassigned,
            "proposed_routing": [],
        }

    # Sort ascending by open_load; the lightest realtor is at the top.
    realtor_loads.sort(key=lambda r: r["open_load"])
    lightest = realtor_loads[0]

    # Team median for the "vs benchmark" framing in the reason string.
    loads = [r["open_load"] for r in realtor_loads]
    loads_sorted = sorted(loads)
    n = len(loads_sorted)
    if n % 2 == 1:
        median_load = float(loads_sorted[n // 2])
    else:
        median_load = (loads_sorted[n // 2 - 1] + loads_sorted[n // 2]) / 2.0
    reason = (
        f"fewest active load ({lightest['open_load']} vs team median "
        f"{median_load:g})"
    )

    proposed_routing = [
        {
            "lead_id": lead["id"],
            "suggested_realtor": {
                "id": lightest["id"],
                "name": lightest["name"],
                "reason": reason,
            },
        }
        for lead in unassigned
    ]

    # Strip the internal-only _fu helper key from leads (none present, but
    # consistent shape) and slim the output a touch.
    slim_leads = [
        {
            "id": l["id"],
            "name": l.get("name"),
            "email": l.get("email"),
            "leadType": l.get("leadType"),
            "leadScore": l.get("leadScore"),
            "scoreLabel": l.get("scoreLabel"),
            "tags": l.get("tags") or [],
            "createdAt": l.get("createdAt").isoformat()
                if isinstance(l.get("createdAt"), datetime)
                else l.get("createdAt"),
        }
        for l in unassigned
    ]

    return {
        "ok": True,
        "unassigned_leads": slim_leads,
        "proposed_routing": proposed_routing,
    }


@function_tool(strict_mode=False)
async def find_breached_leads(
    ctx: RunContextWrapper[AgentContext],
) -> dict[str, Any]:
    """Find routed leads past the brokerage's first-response SLA, oldest first."""
    # Breached = Contact in a member Space tagged 'assigned-by-broker',
    # lastContactedAt IS NULL, createdAt older than slaFirstResponseMinutes.
    # Returns up to _BREACHED_LEAD_LIMIT rows ordered oldest-first; flags any
    # already past slaEscalateMinutes.
    require_broker_role(ctx)
    brokerage_id = ctx.context.brokerage_id

    db = await supabase()
    now = datetime.now(timezone.utc)

    # ── 1. Read brokerage SLA policy ───────────────────────────────────────
    brokerage_res = await (
        db.table("Brokerage")
        .select("id,slaEnabled,slaFirstResponseMinutes,slaEscalateMinutes")
        .eq("id", brokerage_id)
        .maybe_single()
        .execute()
    )
    brokerage = brokerage_res.data or {}
    sla_first_minutes: int = int(
        brokerage.get("slaFirstResponseMinutes") or _DEFAULT_SLA_FIRST_RESPONSE_MINUTES
    )
    sla_escalate_minutes: int | None = (
        int(brokerage["slaEscalateMinutes"])
        if brokerage.get("slaEscalateMinutes") is not None
        else None
    )

    first_response_cutoff = now - timedelta(minutes=sla_first_minutes)

    # ── 2. Resolve member spaces ───────────────────────────────────────────
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
            "breached_leads": [],
            "summary": "No member spaces found for this brokerage.",
        }

    space_to_owner: dict[str, str] = {
        s["id"]: s.get("ownerId") for s in spaces if s.get("id")
    }
    space_ids = list(space_to_owner.keys())

    # ── 3. Query breached contacts ─────────────────────────────────────────
    # Contacts in member spaces that:
    #   - carry the 'assigned-by-broker' tag  (filtered in Python — same
    #     pattern as find_unassigned_leads, since the DB layer has no JSONB
    #     array-contains operator)
    #   - have never been contacted (lastContactedAt IS NULL)
    #   - were created before the first-response cutoff (old enough to breach)
    contacts_res = await (
        db.table("Contact")
        .select("id,name,email,tags,spaceId,createdAt,lastContactedAt")
        .in_("spaceId", space_ids)
        .is_("lastContactedAt", None)
        .lte("createdAt", first_response_cutoff)
        .order("createdAt", desc=False)
        .limit(_BREACHED_LEAD_LIMIT * 3)  # over-fetch; filter tags in Python
        .execute()
    )
    raw = contacts_res.data or []

    breached = [
        c for c in raw
        if "assigned-by-broker" in (c.get("tags") or [])
    ][:_BREACHED_LEAD_LIMIT]

    if not breached:
        return {
            "ok": True,
            "breached_leads": [],
            "summary": (
                f"No leads have breached the {sla_first_minutes}-minute "
                "first-response SLA — all caught up."
            ),
        }

    # ── 4. Resolve realtor names ───────────────────────────────────────────
    owner_ids = list({space_to_owner[c["spaceId"]] for c in breached if c.get("spaceId") in space_to_owner and space_to_owner.get(c["spaceId"])})
    users_by_id: dict[str, dict[str, Any]] = {}
    if owner_ids:
        users_res = await (
            db.table("User")
            .select("id,name,email")
            .in_("id", owner_ids)
            .execute()
        )
        users_by_id = {u["id"]: u for u in (users_res.data or [])}

    # ── 5. Build output rows ───────────────────────────────────────────────
    escalate_cutoff = (
        now - timedelta(minutes=sla_escalate_minutes)
        if sla_escalate_minutes is not None
        else None
    )

    result_rows: list[dict[str, Any]] = []
    for c in breached:
        created_raw = c.get("createdAt")
        if isinstance(created_raw, str):
            try:
                created_dt = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
        elif isinstance(created_raw, datetime):
            created_dt = created_raw
        else:
            continue

        if created_dt.tzinfo is None:
            created_dt = created_dt.replace(tzinfo=timezone.utc)

        minutes_waited = int((now - created_dt).total_seconds() // 60)
        owner_id = space_to_owner.get(c.get("spaceId") or "")
        owner = users_by_id.get(owner_id) if owner_id else None
        realtor_name = (
            (owner or {}).get("name") or (owner or {}).get("email") or "Unknown Realtor"
        )

        past_escalate = (
            escalate_cutoff is not None and created_dt <= escalate_cutoff
        )

        result_rows.append({
            "id": c["id"],
            "name": c.get("name") or "(no name)",
            "email": c.get("email"),
            "minutes_waited": minutes_waited,
            "assigned_to": {
                "id": owner_id or "",
                "name": realtor_name,
            },
            "past_escalate_threshold": past_escalate,
            "createdAt": created_dt.isoformat(),
        })

    # ── 6. Summary sentence ────────────────────────────────────────────────
    oldest = result_rows[0]  # already sorted oldest-first
    escalated_count = sum(1 for r in result_rows if r["past_escalate_threshold"])
    summary_parts = [
        f"{len(result_rows)} lead{'s' if len(result_rows) != 1 else ''} need a first response",
        f"the oldest has waited {oldest['minutes_waited']} min, assigned to {oldest['assigned_to']['name']}",
    ]
    if escalated_count:
        summary_parts.append(
            f"{escalated_count} already past the {sla_escalate_minutes}-min escalation threshold"
        )
    summary = "; ".join(summary_parts) + "."

    return {
        "ok": True,
        "sla_first_response_minutes": sla_first_minutes,
        "sla_escalate_minutes": sla_escalate_minutes,
        "breached_leads": result_rows,
        "summary": summary,
    }


PIPELINE_TOOLS: list = [find_stuck_deals, find_unassigned_leads, find_breached_leads]


__all__ = ["find_stuck_deals", "find_unassigned_leads", "find_breached_leads", "PIPELINE_TOOLS"]
