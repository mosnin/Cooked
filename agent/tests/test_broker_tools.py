"""Contract + permission-gate tests for the 15 broker tools.

Phase 5 of Chippi-for-Brokers — defends three invariants:

  1. Every tool calls `require_broker_role(ctx)` first.
  2. Cross-brokerage scope is enforced where applicable.
  3. Destructive tools require `confirmed=True` to fire and every successful
     write emits an AuditLog row.

We mock the supabase client (mirror `agent/test_db_coercion.py`'s env stubs
so no real DB credentials are needed). The tools are invoked through the
FunctionTool's `on_invoke_tool` machinery, with failure-error functions
disabled so guard refusals re-raise as `BrokerPermissionError` instead of
being silently converted into model-visible strings.

Run from `agent/` with:

    NEXT_PUBLIC_SUPABASE_URL=stub SUPABASE_SERVICE_ROLE_KEY=stub \\
      python -m pytest tests/test_broker_tools.py -v
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# Stub the env vars `config.py` needs, BEFORE any agent import.
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "stub")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")

# Make `import db`, `import security.context`, `import tools.broker.*` work
# when running pytest from the agent/ directory.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.tool_context import ToolContext  # noqa: E402
from agents.usage import Usage  # noqa: E402

from security.context import AgentContext  # noqa: E402
from tools.broker import BROKER_TOOLS  # noqa: E402
from tools.broker._guards import BrokerPermissionError  # noqa: E402
from tools.broker import actions as actions_mod  # noqa: E402
from tools.broker import performance as performance_mod  # noqa: E402
from tools.broker import pipeline as pipeline_mod  # noqa: E402
from tools.broker import revenue as revenue_mod  # noqa: E402
from tools.broker import team as team_mod  # noqa: E402


# ── Fake supabase client ────────────────────────────────────────────────────


class _FakeResult:
    """Mirror of `db.Result`. We don't import `Result` directly so the tools
    only see what they'd see in production — `.data` and `.count`."""

    def __init__(self, data: Any = None, count: int | None = None) -> None:
        self.data = data
        self.count = count


class _FakeQuery:
    """Chainable mock that records every method call and returns whatever
    its owning `_FakeTable` says the terminal `.execute()` should yield.

    The tools use `.select`, `.eq`, `.in_`, `.gte`, `.lte`, `.is_`, `.order`,
    `.limit`, `.maybe_single`, `.insert`, `.update`. We pass every chain
    method through and only resolve at `.execute()`.
    """

    def __init__(self, table_name: str, owner: "_FakeSupabase") -> None:
        self._table_name = table_name
        self._owner = owner
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self._op: str = "select"
        self._payload: Any = None

    def _record(self, name: str, *args: Any) -> "_FakeQuery":
        self.calls.append((name, args))
        return self

    def select(self, *args: Any) -> "_FakeQuery":
        self._op = "select"
        return self._record("select", *args)

    def insert(self, payload: Any) -> "_FakeQuery":
        self._op = "insert"
        self._payload = payload
        return self._record("insert", payload)

    def update(self, payload: Any) -> "_FakeQuery":
        self._op = "update"
        self._payload = payload
        return self._record("update", payload)

    def eq(self, *args: Any) -> "_FakeQuery":
        return self._record("eq", *args)

    def in_(self, *args: Any) -> "_FakeQuery":
        return self._record("in_", *args)

    def gte(self, *args: Any) -> "_FakeQuery":
        return self._record("gte", *args)

    def lte(self, *args: Any) -> "_FakeQuery":
        return self._record("lte", *args)

    def is_(self, *args: Any) -> "_FakeQuery":
        return self._record("is_", *args)

    def order(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self._record("order", *args)

    def limit(self, *args: Any) -> "_FakeQuery":
        return self._record("limit", *args)

    def maybe_single(self) -> "_FakeQuery":
        return self._record("maybe_single")

    def single(self) -> "_FakeQuery":
        return self._record("single")

    async def execute(self) -> _FakeResult:
        # Record the full call (with op + payload) into the owner's log so
        # tests can assert what was actually written.
        self._owner.log.append(
            {
                "table": self._table_name,
                "op": self._op,
                "payload": self._payload,
                "chain": list(self.calls),
            }
        )
        return self._owner.next_result(self._table_name, self._op)


class _FakeRpc:
    def __init__(self, fn: str, params: dict[str, Any], owner: "_FakeSupabase") -> None:
        self.fn = fn
        self.params = params
        self._owner = owner

    async def execute(self) -> _FakeResult:
        self._owner.log.append(
            {"table": "(rpc)", "op": "rpc", "payload": {"fn": self.fn, "params": self.params}, "chain": []}
        )
        return self._owner.next_result(f"rpc:{self.fn}", "rpc")


class _FakeSupabase:
    """The fake `db.Client`. Tests pre-load results keyed by (table, op);
    each call to `.table(...).execute()` pops the matching head result or
    falls back to a default empty payload (which surfaces obviously in
    failing assertions). The full call log is on `.log` for assertions."""

    def __init__(self) -> None:
        self.log: list[dict[str, Any]] = []
        # Stack of pre-loaded results — popped in FIFO order. Most tests
        # need only a couple; the per-call defaults handle the rest.
        self._queue: list[_FakeResult] = []
        # Allow direct override per (table, op).
        self._by_key: dict[tuple[str, str], list[_FakeResult]] = {}

    def queue(self, *results: _FakeResult) -> None:
        self._queue.extend(results)

    def set_for(self, table: str, op: str, *results: _FakeResult) -> None:
        self._by_key.setdefault((table, op), []).extend(results)

    def next_result(self, table: str, op: str) -> _FakeResult:
        # Per-(table,op) override wins.
        key_results = self._by_key.get((table, op))
        if key_results:
            return key_results.pop(0)
        if self._queue:
            return self._queue.pop(0)
        # Default: empty select, no-op write.
        if op in ("insert", "update", "rpc"):
            return _FakeResult(data=None)
        return _FakeResult(data=[])

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(name, self)

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> _FakeRpc:
        return _FakeRpc(fn, params or {}, self)


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _disable_failure_handlers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tools wrap their handler in a failure-error function that turns raised
    exceptions into a model-visible string. For testing we want the original
    exception to surface so we can assert the type/message directly."""
    for tool in BROKER_TOOLS:
        monkeypatch.setattr(tool, "_failure_error_function", None, raising=False)
        monkeypatch.setattr(tool, "_use_default_failure_error_function", False, raising=False)


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch) -> _FakeSupabase:
    """Replace every `supabase()` import with a fake. Each broker tool module
    imports `from db import supabase` at module scope, so we patch on the
    module attribute, not on `db.supabase` (which would only affect future
    imports)."""
    fake = _FakeSupabase()

    async def _fake_supabase() -> _FakeSupabase:
        return fake

    for mod in (team_mod, pipeline_mod, revenue_mod, performance_mod, actions_mod):
        monkeypatch.setattr(mod, "supabase", _fake_supabase)
    return fake


def _ctx(
    *,
    broker_role: str = "broker_owner",
    brokerage_id: str = "bk_a",
    user_id: str = "u_broker",
) -> AgentContext:
    return AgentContext(
        space_id="s_broker",
        space_name="Broker Workspace",
        daily_token_budget=10_000,
        run_id="run-test",
        user_id=user_id,
        brokerage_id=brokerage_id,
        broker_role=broker_role,
    )


def _tool_ctx(agent_ctx: AgentContext, tool_name: str, args_json: str = "{}") -> ToolContext:
    return ToolContext(
        context=agent_ctx,
        usage=Usage(),
        tool_name=tool_name,
        tool_call_id=f"call_{tool_name}",
        tool_arguments=args_json,
    )


async def _invoke(tool: Any, agent_ctx: AgentContext, args: dict[str, Any] | None = None) -> Any:
    args_json = json.dumps(args or {})
    return await tool.on_invoke_tool(_tool_ctx(agent_ctx, tool.name, args_json), args_json)


def _tool_by_name(name: str) -> Any:
    for t in BROKER_TOOLS:
        if t.name == name:
            return t
    raise LookupError(f"No broker tool named {name!r}")


# ── 1. Permission gate fires on every tool ──────────────────────────────────


_ALL_TOOL_INPUTS: list[tuple[str, dict[str, Any]]] = [
    ("team_health", {}),
    ("realtor_performance", {"realtor_id": "u_realtor"}),
    ("read_realtor_morning_story", {"realtor_id": "u_realtor"}),
    ("find_stuck_deals", {}),
    ("find_unassigned_leads", {}),
    ("find_breached_leads", {}),
    ("commission_report", {}),
    ("audit_response_times", {}),
    ("find_at_risk_agents", {}),
    ("reassign_lead", {"lead_id": "c_lead", "to_realtor_id": "u_realtor"}),
    ("flag_deal_for_broker_review", {"deal_id": "d1", "reason": "needs a look here please"}),
    ("send_team_announcement", {"message": "stand-up at 9am"}),
    ("change_member_role", {"member_id": "m1", "new_role": "broker_admin"}),
    ("offboard_member", {"member_id": "m1"}),
    ("set_routing_rule", {"strategy": "round_robin"}),
]


@pytest.mark.parametrize(("tool_name", "args"), _ALL_TOOL_INPUTS)
@pytest.mark.asyncio
async def test_non_broker_ctx_is_refused(tool_name: str, args: dict[str, Any]) -> None:
    """Every broker tool refuses a non-broker caller before doing any work.

    The guard is the very first line of every handler. We don't even need a
    DB mock here — if the guard fires, no DB call is attempted.
    """
    tool = _tool_by_name(tool_name)
    ctx = _ctx(broker_role="realtor_member")
    with pytest.raises(BrokerPermissionError):
        await _invoke(tool, ctx, args)


@pytest.mark.parametrize(("tool_name", "args"), _ALL_TOOL_INPUTS)
@pytest.mark.asyncio
async def test_empty_role_is_refused(tool_name: str, args: dict[str, Any]) -> None:
    """An empty broker_role (autonomous run / missing context) is refused."""
    tool = _tool_by_name(tool_name)
    ctx = _ctx(broker_role="")
    with pytest.raises(BrokerPermissionError):
        await _invoke(tool, ctx, args)


# ── 2. Cross-brokerage scope ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_realtor_performance_refuses_cross_brokerage(fake_db: _FakeSupabase) -> None:
    """`realtor_performance` runs against a realtor whose Space lives in a
    DIFFERENT brokerage — must refuse with BrokerPermissionError."""
    fake_db.set_for(
        "Space",
        "select",
        _FakeResult(
            data={"id": "s_other", "ownerId": "u_realtor", "brokerageId": "bk_OTHER", "name": "Other Brokerage"}
        ),
    )
    tool = _tool_by_name("realtor_performance")
    ctx = _ctx(brokerage_id="bk_a")
    with pytest.raises(BrokerPermissionError):
        await _invoke(tool, ctx, {"realtor_id": "u_realtor"})


@pytest.mark.asyncio
async def test_read_realtor_morning_story_refuses_cross_brokerage(fake_db: _FakeSupabase) -> None:
    """Same cross-brokerage refusal on `read_realtor_morning_story`."""
    fake_db.set_for(
        "Space",
        "select",
        _FakeResult(data={"id": "s_other", "ownerId": "u_realtor", "brokerageId": "bk_OTHER"}),
    )
    tool = _tool_by_name("read_realtor_morning_story")
    ctx = _ctx(brokerage_id="bk_a")
    with pytest.raises(BrokerPermissionError):
        await _invoke(tool, ctx, {"realtor_id": "u_realtor"})


@pytest.mark.asyncio
async def test_reassign_lead_refuses_cross_brokerage_contact(fake_db: _FakeSupabase) -> None:
    """`reassign_lead` returns ok=false when the contact is missing for this
    brokerage. The TS path scopes contact lookup to brokerage_id, and falls
    back to the broker owner's space — both lookups should miss for a
    cross-brokerage lead. We mock contact lookup as None and ensure the
    Brokerage row in `_resolve_broker_space` also returns no useful space.
    """
    # First contact lookup (by brokerageId): miss.
    fake_db.set_for("Contact", "select", _FakeResult(data=None))
    # `_resolve_broker_space` then queries Brokerage; return a row but with
    # no matching space the second query won't help.
    fake_db.set_for(
        "Brokerage",
        "select",
        _FakeResult(data={"id": "bk_a", "ownerId": "u_broker", "name": "B"}),
    )
    # The broker-owner's Space lookup yields a space (s_broker).
    fake_db.set_for(
        "Space",
        "select",
        _FakeResult(data={"id": "s_broker", "ownerId": "u_broker", "name": "Broker Space", "brokerageId": "bk_a"}),
    )
    # Second contact lookup (by broker_space.space_id): also miss.
    fake_db.set_for("Contact", "select", _FakeResult(data=None), )

    tool = _tool_by_name("reassign_lead")
    ctx = _ctx(brokerage_id="bk_a")
    res = await _invoke(tool, ctx, {"lead_id": "c_other", "to_realtor_id": "u_realtor"})
    assert res["ok"] is False
    assert "brokerage" in res["summary"].lower() or "not found" in res["summary"].lower()


# ── 3. Confirmation gate on change_member_role ──────────────────────────────


@pytest.mark.asyncio
async def test_change_member_role_first_call_requires_confirmation(fake_db: _FakeSupabase) -> None:
    """First call (confirmed=False) returns requires_confirmation=True and
    does NOT write anything."""
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data={"id": "m1", "userId": "u_realtor", "role": "realtor_member", "brokerageId": "bk_a"}
        ),
    )
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_realtor", "name": "Alice", "email": "alice@x.com"}),
    )

    tool = _tool_by_name("change_member_role")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(tool, ctx, {"member_id": "m1", "new_role": "broker_admin"})
    assert res["ok"] is False
    assert res["requires_confirmation"] is True
    # No UPDATE happened.
    assert not any(c["op"] == "update" for c in fake_db.log)


@pytest.mark.asyncio
async def test_change_member_role_confirmed_executes(fake_db: _FakeSupabase) -> None:
    """Same call with confirmed=True performs the UPDATE and writes audit."""
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data={"id": "m1", "userId": "u_realtor", "role": "realtor_member", "brokerageId": "bk_a"}
        ),
    )
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_realtor", "name": "Alice", "email": "alice@x.com"}),
    )

    tool = _tool_by_name("change_member_role")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(
        tool,
        ctx,
        {"member_id": "m1", "new_role": "broker_admin", "confirmed": True},
    )
    assert res["ok"] is True
    assert res["newRole"] == "broker_admin"
    assert any(c["table"] == "BrokerageMembership" and c["op"] == "update" for c in fake_db.log)
    assert any(c["table"] == "AuditLog" and c["op"] == "insert" for c in fake_db.log)


# ── 4. Confirmation gate on offboard_member ─────────────────────────────────


@pytest.mark.asyncio
async def test_offboard_member_first_call_requires_confirmation(fake_db: _FakeSupabase) -> None:
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data={"id": "m1", "userId": "u_realtor", "role": "realtor_member", "brokerageId": "bk_a"}
        ),
    )
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_realtor", "name": "Alice", "email": "alice@x.com", "status": "active"}),
    )

    tool = _tool_by_name("offboard_member")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(tool, ctx, {"member_id": "m1"})
    assert res["ok"] is False
    assert res["requires_confirmation"] is True
    # No RPC or AuditLog write happened.
    assert not any(c["op"] == "rpc" for c in fake_db.log)
    assert not any(c["table"] == "AuditLog" for c in fake_db.log)


@pytest.mark.asyncio
async def test_offboard_member_confirmed_calls_rpc(fake_db: _FakeSupabase) -> None:
    """Confirmed call fires the offboard_brokerage_member RPC and audits."""
    # Target membership.
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data={"id": "m1", "userId": "u_realtor", "role": "realtor_member", "brokerageId": "bk_a"}
        ),
        # Destination membership.
        _FakeResult(
            data={"id": "m2", "userId": "u_dest", "role": "realtor_member", "brokerageId": "bk_a"}
        ),
    )
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_realtor", "name": "Alice", "email": "alice@x.com", "status": "active"}),
        _FakeResult(data={"id": "u_dest", "name": "Jordan", "email": "jordan@x.com", "status": "active"}),
    )
    # RPC result with counts.
    fake_db.set_for(
        "rpc:offboard_brokerage_member",
        "rpc",
        _FakeResult(data=[{"contacts_moved": 4, "deals_moved": 2, "tours_moved": 1}]),
    )

    tool = _tool_by_name("offboard_member")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(
        tool,
        ctx,
        {"member_id": "m1", "destination_member_id": "m2", "confirmed": True},
    )
    assert res["ok"] is True
    assert res["contactsMoved"] == 4
    assert res["dealsMoved"] == 2
    assert res["toursMoved"] == 1
    rpc_calls = [c for c in fake_db.log if c["op"] == "rpc"]
    assert len(rpc_calls) == 1
    assert rpc_calls[0]["payload"]["fn"] == "offboard_brokerage_member"
    assert any(c["table"] == "AuditLog" and c["op"] == "insert" for c in fake_db.log)


# ── 5. AuditLog write on every write tool ───────────────────────────────────


@pytest.mark.asyncio
async def test_reassign_lead_writes_audit(fake_db: _FakeSupabase) -> None:
    """Successful reassign_lead emits an AuditLog insert."""
    # Contact lookup by brokerageId succeeds.
    fake_db.set_for(
        "Contact",
        "select",
        _FakeResult(
            data={
                "id": "c1",
                "name": "Sarah",
                "spaceId": "s_broker",
                "brokerageId": "bk_a",
                "tags": ["brokerage-lead", "new-lead"],
                "phone": None,
                "email": None,
                "leadType": "buyer",
                "leadScore": 70,
            }
        ),
        # Refetch full row at the clone step.
        _FakeResult(
            data={
                "id": "c1",
                "name": "Sarah",
                "spaceId": "s_broker",
                "brokerageId": "bk_a",
                "tags": ["brokerage-lead", "new-lead"],
                "type": "QUALIFICATION",
                "leadType": "buyer",
                "properties": [],
                "leadScore": 70,
            }
        ),
    )
    # `_resolve_broker_space` chain.
    fake_db.set_for(
        "Brokerage",
        "select",
        _FakeResult(data={"id": "bk_a", "ownerId": "u_broker", "name": "B"}),
    )
    # Space lookups: broker's space, target realtor's space.
    fake_db.set_for(
        "Space",
        "select",
        _FakeResult(data={"id": "s_broker", "ownerId": "u_broker", "name": "Broker", "brokerageId": "bk_a"}),
        _FakeResult(data={"id": "s_realtor", "ownerId": "u_realtor", "name": "Realtor", "brokerageId": "bk_a"}),
    )
    # Membership for target realtor.
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data={"id": "m_realtor", "userId": "u_realtor", "role": "realtor_member"}
        ),
    )
    # Target user.
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_realtor", "name": "Jordan", "email": "j@x.com"}),
    )

    tool = _tool_by_name("reassign_lead")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(
        tool,
        ctx,
        {"lead_id": "c1", "to_realtor_id": "u_realtor", "reason": "lighter load"},
    )
    assert res["ok"] is True
    audit_inserts = [
        c for c in fake_db.log if c["table"] == "AuditLog" and c["op"] == "insert"
    ]
    assert len(audit_inserts) >= 1
    payload = audit_inserts[0]["payload"]
    assert payload["resource"] == "Contact"
    assert payload["action"] == "UPDATE"
    assert payload["metadata"]["operation"] == "reassign_lead"


@pytest.mark.asyncio
async def test_flag_deal_writes_audit(fake_db: _FakeSupabase) -> None:
    fake_db.set_for(
        "Deal",
        "select",
        _FakeResult(data={"id": "d1", "title": "Sarah Chen — 123 Main", "spaceId": "s_realtor", "status": "active"}),
    )
    fake_db.set_for(
        "Space",
        "select",
        _FakeResult(data={"id": "s_realtor", "ownerId": "u_realtor", "brokerageId": "bk_a"}),
    )

    tool = _tool_by_name("flag_deal_for_broker_review")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(
        tool,
        ctx,
        {"deal_id": "d1", "reason": "needs eyes on commission"},
    )
    assert res["ok"] is True
    audits = [c for c in fake_db.log if c["table"] == "AuditLog" and c["op"] == "insert"]
    assert len(audits) == 1
    assert audits[0]["payload"]["resource"] == "DealReviewRequest"
    assert audits[0]["payload"]["action"] == "CREATE"


@pytest.mark.asyncio
async def test_send_team_announcement_writes_audit(fake_db: _FakeSupabase) -> None:
    fake_db.set_for(
        "Brokerage",
        "select",
        _FakeResult(data={"id": "bk_a", "ownerId": "u_broker", "name": "Apex"}),
    )
    fake_db.set_for(
        "Space",
        "select",
        _FakeResult(data={"id": "s_broker", "ownerId": "u_broker", "name": "Broker", "brokerageId": "bk_a"}),
    )
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_broker", "name": "Sam", "email": "sam@x.com"}),
    )
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data=[
                {"id": "m1", "userId": "u_broker", "role": "broker_owner"},
                {"id": "m2", "userId": "u_realtor", "role": "realtor_member"},
            ]
        ),
    )

    tool = _tool_by_name("send_team_announcement")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(tool, ctx, {"message": "Standup at 9", "urgency": "normal"})
    assert res["ok"] is True
    audits = [c for c in fake_db.log if c["table"] == "AuditLog" and c["op"] == "insert"]
    assert len(audits) == 1
    assert audits[0]["payload"]["resource"] == "Note"
    assert audits[0]["payload"]["metadata"]["operation"] == "send_team_announcement"


@pytest.mark.asyncio
async def test_set_routing_rule_writes_audit(fake_db: _FakeSupabase) -> None:
    fake_db.set_for(
        "Brokerage",
        "select",
        _FakeResult(
            data={
                "id": "bk_a",
                "name": "Apex",
                "autoAssignEnabled": False,
                "assignmentMethod": "manual",
            }
        ),
    )

    tool = _tool_by_name("set_routing_rule")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(tool, ctx, {"strategy": "round_robin"})
    assert res["ok"] is True
    audits = [c for c in fake_db.log if c["table"] == "AuditLog" and c["op"] == "insert"]
    assert len(audits) == 1
    assert audits[0]["payload"]["resource"] == "Brokerage"
    assert audits[0]["payload"]["metadata"]["operation"] == "set_routing_rule"
    # Engine reads assignmentMethod + autoAssignEnabled — confirm both moved.
    updates = [c for c in fake_db.log if c["table"] == "Brokerage" and c["op"] == "update"]
    assert len(updates) == 1
    payload = updates[0]["payload"]
    assert payload["assignmentMethod"] == "round_robin"
    assert payload["autoAssignEnabled"] is True


# ── 6. broker_admin can only move realtor_member ⇄ realtor_member ───────────


@pytest.mark.asyncio
async def test_change_member_role_admin_cannot_change_other_admins(
    fake_db: _FakeSupabase,
) -> None:
    """A broker_admin caller cannot demote another broker_admin to
    realtor_member — that move is owner-only."""
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data={"id": "m_other_admin", "userId": "u_admin2", "role": "broker_admin", "brokerageId": "bk_a"}
        ),
    )
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_admin2", "name": "Casey", "email": "casey@x.com"}),
    )

    tool = _tool_by_name("change_member_role")
    ctx = _ctx(broker_role="broker_admin")
    res = await _invoke(
        tool,
        ctx,
        {"member_id": "m_other_admin", "new_role": "realtor_member", "confirmed": True},
    )
    assert res["ok"] is False
    assert "owner" in res["summary"].lower()
    # No UPDATE happened — admin attempted owner-only move.
    assert not any(c["table"] == "BrokerageMembership" and c["op"] == "update" for c in fake_db.log)


@pytest.mark.asyncio
async def test_change_member_role_admin_cannot_promote_to_admin(
    fake_db: _FakeSupabase,
) -> None:
    """A broker_admin cannot promote a realtor_member to broker_admin
    either — promotion-to-admin is owner-only."""
    fake_db.set_for(
        "BrokerageMembership",
        "select",
        _FakeResult(
            data={"id": "m_realtor", "userId": "u_realtor", "role": "realtor_member", "brokerageId": "bk_a"}
        ),
    )
    fake_db.set_for(
        "User",
        "select",
        _FakeResult(data={"id": "u_realtor", "name": "Alice", "email": "alice@x.com"}),
    )

    tool = _tool_by_name("change_member_role")
    ctx = _ctx(broker_role="broker_admin")
    res = await _invoke(
        tool,
        ctx,
        {"member_id": "m_realtor", "new_role": "broker_admin", "confirmed": True},
    )
    assert res["ok"] is False
    assert "owner" in res["summary"].lower()


@pytest.mark.asyncio
async def test_offboard_member_admin_refused(fake_db: _FakeSupabase) -> None:
    """offboard_member is broker_owner-only — broker_admin gets refused."""
    tool = _tool_by_name("offboard_member")
    ctx = _ctx(broker_role="broker_admin")
    res = await _invoke(tool, ctx, {"member_id": "m1"})
    assert res["ok"] is False
    assert "owner" in res["summary"].lower()


# ── 7. set_routing_rule rejects unknown enum values ─────────────────────────


@pytest.mark.asyncio
async def test_set_routing_rule_rejects_invalid_strategy(fake_db: _FakeSupabase) -> None:
    """Anything outside {manual, round_robin, score_based} is refused.

    The Literal annotation on the tool parameter is enforced by the
    openai-agents SDK before our body runs — invalid input raises
    ModelBehaviorError, never reaches our `_VALID_ROUTING` check, and
    never touches the DB. The runtime check inside the tool is a
    belt-and-suspenders guard for callers (and the future shape of
    strict_mode); the SDK does the work.
    """
    from agents.exceptions import ModelBehaviorError

    tool = _tool_by_name("set_routing_rule")
    ctx = _ctx(broker_role="broker_owner")
    with pytest.raises(ModelBehaviorError):
        await _invoke(tool, ctx, {"strategy": "lol_not_a_strategy"})
    # No UPDATE attempted.
    assert not any(c["table"] == "Brokerage" and c["op"] == "update" for c in fake_db.log)


@pytest.mark.parametrize("strategy", ["manual", "round_robin", "score_based"])
@pytest.mark.asyncio
async def test_set_routing_rule_accepts_valid_enum(
    fake_db: _FakeSupabase, strategy: str
) -> None:
    """All three valid strategies are accepted and applied."""
    fake_db.set_for(
        "Brokerage",
        "select",
        _FakeResult(
            data={
                "id": "bk_a",
                "name": "Apex",
                "autoAssignEnabled": False,
                "assignmentMethod": "manual",
            }
        ),
    )
    tool = _tool_by_name("set_routing_rule")
    ctx = _ctx(broker_role="broker_owner")
    res = await _invoke(tool, ctx, {"strategy": strategy})
    if strategy == "manual":
        # Previous=manual, no change.
        assert res.get("unchanged") is True
        assert res["ok"] is True
    else:
        assert res["ok"] is True
        assert res["newStrategy"] == strategy
        updates = [c for c in fake_db.log if c["table"] == "Brokerage" and c["op"] == "update"]
        assert len(updates) == 1
        payload = updates[0]["payload"]
        assert payload["assignmentMethod"] == strategy
        assert payload["autoAssignEnabled"] is True


# ── Sanity: BROKER_TOOLS has all 15 tools registered ────────────────────────


def test_broker_tools_registry_has_fifteen() -> None:
    assert len(BROKER_TOOLS) == 15
    names = {t.name for t in BROKER_TOOLS}
    expected = {
        "team_health",
        "realtor_performance",
        "read_realtor_morning_story",
        "find_stuck_deals",
        "find_unassigned_leads",
        "find_breached_leads",
        "commission_report",
        "audit_response_times",
        "find_at_risk_agents",
        "reassign_lead",
        "flag_deal_for_broker_review",
        "send_team_announcement",
        "change_member_role",
        "offboard_member",
        "set_routing_rule",
    }
    assert names == expected
