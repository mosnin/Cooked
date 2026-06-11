"""Planning tool — structure and announce a multi-step execution plan.

This is a meta-tool: it doesn't write to the CRM or call any external
service. Its job is to emit a structured plan event before the agent
executes a sequence of steps, so the realtor can see what's coming in
the activity feed and in the chat stream.

The agent MUST call create_plan when a task requires 3 or more tool calls
across different contacts, deals, or calendar events. Single-entity lookups
and simple one-step tasks should NOT trigger planning — the overhead is not
worth it.

After calling create_plan, the agent executes the steps in the announced
order. The plan is advisory: the agent may skip a step if a lookup returns
nothing, but it should not add unannounced steps.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel

from security.context import AgentContext
from tools.streaming import publish_event


class PlanStep(BaseModel):
    title: str
    description: str = ""


@function_tool(strict_mode=False)
async def create_plan(
    ctx: RunContextWrapper[AgentContext],
    task: str,
    steps: list[PlanStep],
) -> dict[str, Any]:
    """Announce a structured execution plan before a multi-step task (3+ tool calls)."""
    # task: one-sentence overall goal. steps: ordered [{title, description}].
    # Skip for simple lookups.
    if not task or not isinstance(task, str):
        return {"error": "task must be a non-empty string"}
    if not steps:
        return {"error": "steps must be a non-empty list"}

    clean_steps: list[dict[str, str]] = []
    for i, step in enumerate(steps):
        title = (step.title or "").strip()
        description = (step.description or "").strip()
        if not title:
            return {"error": f"step {i} is missing a 'title'"}
        clean_steps.append({"title": title, "description": description})

    plan = {"task": task.strip(), "steps": clean_steps}

    # Publish to the realtor's activity feed / SSE stream so they see the
    # plan before the agent starts executing.
    step_lines = "\n".join(
        f"  {idx + 1}. {s['title']}" + (f": {s['description']}" if s["description"] else "")
        for idx, s in enumerate(clean_steps)
    )
    await publish_event(
        ctx.context,
        "info",
        f"Plan: {task.strip()}\n{step_lines}",
        metadata={"plan": plan},
        agent_type=ctx.context.current_agent_type,
    )

    return plan
