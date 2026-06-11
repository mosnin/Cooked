"""Tool-runtime permission guard for broker tools (defense layer 3).

Three layers gate every broker-side action; this file is the last one:

  1. ROUTE GUARD     — `app/broker/chippi/page.tsx` server component
                       redirects when the caller isn't a broker.
  2. API GATE        — `app/api/ai/broker-task/route.ts` re-runs
                       `resolveBrokerContext()` before posting to Modal.
  3. TOOL-RUNTIME    — this guard. Every broker tool MUST call it before
                       doing any work; a tool that skips it would execute
                       even if a misconfigured caller slipped past layers
                       1 and 2.

The contract is enforced at THIS layer because the agent runs inside a Modal
sandbox far away from the Next.js auth surface. Modal has only the context
the Next.js route hands it; if a future bug lets a non-broker context reach
here, the broker tools must still refuse.

Phase 2/3 tools wrap their handler body like this:

    @function_tool(strict_mode=False)
    async def some_broker_tool(ctx: RunContextWrapper[AgentContext], ...):
        require_broker_role(ctx)        # ← MUST come before any DB call
        # ... rest of the handler ...

`require_broker_role` raises `BrokerPermissionError` on refusal. The Agents
SDK serialises tool exceptions into model-visible tool outputs, so the model
sees a clear refusal and won't loop on the same tool — and the realtor /
broker never sees raw DB state from a tool that shouldn't have run.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agents import RunContextWrapper

    from security.context import AgentContext


# Roles permitted to invoke broker tools. realtor_member is excluded — they
# get the realtor Chippi at /s/<slug>/chippi, not the brokerage chief-of-staff.
_BROKER_ROLES: frozenset[str] = frozenset({"broker_owner", "broker_admin"})


class BrokerPermissionError(RuntimeError):
    """Raised when a broker tool runs without a broker-role caller.

    Distinct exception type so the agent runtime can log this category
    separately from generic tool errors — a permission-error spike means
    either a real attack attempt or a context-wiring bug, both worth alerting
    on.
    """


def require_broker_role(ctx: "RunContextWrapper[AgentContext]") -> None:
    """Refuse the call unless the AgentContext carries a broker role.

    Reads `ctx.context.broker_role` — populated by the Next.js broker-task
    route from `resolveBrokerContext()` and forwarded to Modal as part of
    the `chat_turn` request payload. Empty / unset / realtor_member → refuse.

    Raises
    ------
    BrokerPermissionError
        When the caller is not `broker_owner` or `broker_admin`. The
        message intentionally omits the offending role to avoid leaking
        which roles exist; the broker just sees a flat refusal.
    """
    agent_ctx = ctx.context
    role = (getattr(agent_ctx, "broker_role", "") or "").strip().lower()
    if role not in _BROKER_ROLES:
        raise BrokerPermissionError(
            "Broker tools are reserved for the brokerage's owner or admins."
        )


__all__ = ["BrokerPermissionError", "require_broker_role"]
