"""Tool-runtime permission guard for manager tools (defense layer 3).

Three layers gate every manager-side action; this file is the last one:

  1. ROUTE GUARD     — `app/manager/koala/page.tsx` server component
                       redirects when the caller isn't a manager.
  2. API GATE        — `app/api/ai/manager-task/route.ts` re-runs
                       `resolveManagerContext()` before posting to Modal.
  3. TOOL-RUNTIME    — this guard. Every manager tool MUST call it before
                       doing any work; a tool that skips it would execute
                       even if a misconfigured caller slipped past layers
                       1 and 2.

The contract is enforced at THIS layer because the agent runs inside a Modal
sandbox far away from the Next.js auth surface. Modal has only the context
the Next.js route hands it; if a future bug lets a non-manager context reach
here, the manager tools must still refuse.

Phase 2/3 tools wrap their handler body like this:

    @function_tool(strict_mode=False)
    async def some_manager_tool(ctx: RunContextWrapper[AgentContext], ...):
        require_manager_role(ctx)        # ← MUST come before any DB call
        # ... rest of the handler ...

`require_manager_role` raises `ManagerPermissionError` on refusal. The Agents
SDK serialises tool exceptions into model-visible tool outputs, so the model
sees a clear refusal and won't loop on the same tool — and the rep /
manager never sees raw DB state from a tool that shouldn't have run.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agents import RunContextWrapper

    from security.context import AgentContext


# Roles permitted to invoke manager tools. rep_member is excluded — they
# get the rep Koala at /s/<slug>/koala, not the team chief-of-staff.
_MANAGER_ROLES: frozenset[str] = frozenset({"manager_owner", "manager_admin"})


class ManagerPermissionError(RuntimeError):
    """Raised when a manager tool runs without a manager-role caller.

    Distinct exception type so the agent runtime can log this category
    separately from generic tool errors — a permission-error spike means
    either a real attack attempt or a context-wiring bug, both worth alerting
    on.
    """


def require_manager_role(ctx: "RunContextWrapper[AgentContext]") -> None:
    """Refuse the call unless the AgentContext carries a manager role.

    Reads `ctx.context.manager_role` — populated by the Next.js manager-task
    route from `resolveManagerContext()` and forwarded to Modal as part of
    the `chat_turn` request payload. Empty / unset / rep_member → refuse.

    Raises
    ------
    ManagerPermissionError
        When the caller is not `manager_owner` or `manager_admin`. The
        message intentionally omits the offending role to avoid leaking
        which roles exist; the manager just sees a flat refusal.
    """
    agent_ctx = ctx.context
    role = (getattr(agent_ctx, "manager_role", "") or "").strip().lower()
    if role not in _MANAGER_ROLES:
        raise ManagerPermissionError(
            "Manager tools are reserved for the team's owner or admins."
        )


__all__ = ["ManagerPermissionError", "require_manager_role"]
