#!/usr/bin/env python3
"""Chippi agent eval runner — tool-routing regression net.

Runs each case in cases.json against a real Chippi agent, but with every
FunctionTool stubbed at the SDK level so no real DB, Composio, or external
service is touched. The model still sees the full tool catalog and decides
what to call; we capture the call sequence and score it against the case's
expected block.

What it catches: routing regressions. "Send X@gmail.com a test email" stopped
calling draft_message and started calling find_integration_tool. "Find Jane"
started bouncing through ask_realtor. Every fix to the system prompt or the
tool descriptions risks re-breaking the case it didn't touch — this runner
re-checks every case in <a minute and exits non-zero on regression.

What it does NOT catch: tool implementation bugs, integration auth, prompt
quality. Use the live evals (RUN_EVALS=1 pnpm test:evals) for those. This
runner is fast, cheap, deterministic-ish, and offline.

Usage:
    python tests/agent-eval/run.py
    python tests/agent-eval/run.py --model openai/gpt-5-mini
    python tests/agent-eval/run.py --only outreach-raw-email
    pnpm run agent:eval

Gating:
    Requires OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY. On a dev box
    with neither, the runner skips with exit 0 and a one-line note — so it's
    safe to wire into pre-commit hooks without becoming a hard blocker.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import traceback
import uuid
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Path + env setup. Must happen BEFORE we import any chippi/* modules so the
# `from chippi import …` style imports inside agent/ resolve.
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_AGENT_DIR = _REPO_ROOT / "agent"
sys.path.insert(0, str(_AGENT_DIR))

# Stuff config.py needs to instantiate Settings — these are dummy values
# because we never actually talk to Supabase. Set BEFORE importing anything
# from agent/.
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://eval.stub.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eval-stub-service-role-key")
os.environ.setdefault("NEXT_PUBLIC_APP_URL", "https://eval.stub.invalid")
os.environ.setdefault("AGENT_INTERNAL_SECRET", "eval-stub-internal-secret")
# Drop the openai-agents SDK into a quieter mode for the eval — tracing
# exports would otherwise fail on the stub OPENAI_API_KEY.
os.environ.setdefault("OPENAI_AGENTS_DISABLE_TRACING", "1")


CASES_PATH = Path(__file__).parent / "cases.json"


# ---------------------------------------------------------------------------
# Stub returns — shape-correct enough that the model can keep running without
# looping on "I didn't understand that result". Goal is to capture the FIRST
# routing decision, not to script a full multi-turn play.
# ---------------------------------------------------------------------------

_STUB_RETURNS: dict[str, Any] = {
    "find_contacts": [
        {
            "id": "c_eval_stub",
            "name": "Jane Chen",
            "email": "jane@example.com",
            "phone": "+14155550000",
            "leadType": "buyer",
            "leadScore": 78,
            "scoreLabel": "hot",
        }
    ],
    "find_deals": [
        {
            "id": "d_eval_stub",
            "title": "Chen — 412 Elm",
            "value": 1_100_000,
            "status": "active",
            "stageId": "stage_offer",
        }
    ],
    "get_contact_activity": {"contact": {"id": "c_eval_stub"}, "activity": []},
    "create_contact": {"action": "created", "contactId": "c_eval_stub", "name": "Stub Contact"},
    "create_deal": {"action": "created", "dealId": "d_eval_stub", "title": "Stub Deal"},
    "update_contact": {"action": "updated", "contactId": "c_eval_stub"},
    "update_deal": {"action": "updated", "dealId": "d_eval_stub"},
    "advance_deal_stage": {"action": "advanced", "dealId": "d_eval_stub", "stage": "Under Contract"},
    "request_deal_review": {"action": "requested", "dealId": "d_eval_stub"},
    "book_tour": {"action": "booked", "tourId": "t_eval_stub", "when": "2026-06-01T14:00:00Z"},
    "route_lead": {"action": "previewed", "destinationRealtor": "Eval Realtor"},
    "add_property": {"action": "added", "propertyId": "p_eval_stub"},
    "send_property_packet": {
        "action": "drafted",
        "draftId": "draft_packet_stub",
        "contactId": "c_eval_stub",
        "channel": "email",
        "nextStep": "Drafted packet share — review in your inbox.",
    },
    "recall_memory": {"matches": []},
    "store_memory": {"action": "stored", "memoryId": "m_eval_stub"},
    "manage_goal": {"action": "noop", "goalId": "g_eval_stub"},
    "manage_routines": {"action": "noop"},
    "draft_message": {
        "action": "drafted",
        "draftId": "draft_stub_eval",
        "contactId": "c_eval_stub",
        "channel": "email",
        "autoCreatedContact": False,
        "nextStep": "Drafted — review and approve in your inbox to send.",
    },
    "outcome": {"action": "recorded"},
    "analyze_portfolio": {"summary": "Eval stub portfolio.", "metrics": {}},
    "generate_priority_list": {"items": []},
    "process_inbound_message": {"action": "queued"},
    "read_attachment": {"text": "Eval stub attachment body."},
    "ask_realtor": {"action": "asked", "questionId": "q_eval_stub"},
    "log_activity_run": {"action": "logged"},
    "recall_docs": {"matches": [{"title": "Stub doc", "snippet": "Eval stub."}]},
    "create_plan": {"action": "planned", "planId": "plan_eval_stub", "steps": []},
    "get_intake_form": {"leadType": "buyer", "sections": []},
    "add_intake_question": {"action": "added"},
    "remove_intake_question": {"action": "removed"},
    "update_intake_question": {"action": "updated"},
    "save_intake_form": {"action": "saved"},
    "generate_studio_image": {"action": "generated", "fileId": "f_eval_stub", "url": "https://stub"},
    "edit_studio_image": {"action": "edited", "fileId": "f_eval_stub2"},
    # Integration dispatcher — return a plausibly-shaped empty result so the
    # model can continue without looping. The captured call is what matters.
    "find_integration_tool": json.dumps({"tools": []}),
    "call_integration_tool": json.dumps({"ok": True, "data": {"note": "eval stub"}}),
}


def _stub_return_for(tool_name: str) -> Any:
    """Canned return value for a tool. Defaults to a generic ok dict."""
    if tool_name in _STUB_RETURNS:
        return _STUB_RETURNS[tool_name]
    return {"action": "noop", "_stub": True}


# ---------------------------------------------------------------------------
# The capture machinery. One CallRecord per tool invocation the model makes.
# ---------------------------------------------------------------------------


class CallRecord:
    __slots__ = ("tool", "args")

    def __init__(self, tool: str, args: dict[str, Any]) -> None:
        self.tool = tool
        self.args = args

    def __repr__(self) -> str:  # pragma: no cover
        return f"CallRecord({self.tool}, {self.args})"


def _build_synthetic_curated_tools(connected_toolkits: list[str]) -> list:
    """Build the curated FunctionTools the realtor would see in prod.

    Real prod (integrations.load_integration_tools) fetches each action's
    JSON schema from Composio via HTTP. For routing assertions we only
    need the tool's *name* to be visible to the model — the actual
    schema can be a permissive empty-object since the eval stub captures
    whatever args the model passes without validating them.

    Names go through the same `_safe_tool_name` as prod so the names a
    case asserts on (gmail_send_email, googlecalendar_events_list, …) match
    exactly what prod's loader would produce.
    """
    try:
        from agents import FunctionTool
    except ImportError:  # older SDK path
        from agents.tool import FunctionTool

    from integrations import _safe_tool_name  # type: ignore
    from integrations_curated import curated_slugs_for

    permissive_schema: dict[str, Any] = {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": True,
    }
    tools: list = []
    seen_names: set[str] = set()
    for toolkit in connected_toolkits:
        for slug in curated_slugs_for(toolkit):
            name = _safe_tool_name(slug, toolkit)
            if name in seen_names:
                continue
            seen_names.add(name)

            # The on_invoke_tool we attach here is a temporary placeholder
            # — the global _patch_tools_to_capture pass below replaces it
            # with the capturing stub. We just need the FunctionTool to
            # exist so the model sees the name + schema.
            async def _placeholder(_ctx, _args_json: str) -> str:
                return "{}"

            tools.append(
                FunctionTool(
                    name=name,
                    description=f"[curated stub] {slug} via {toolkit}.",
                    params_json_schema=permissive_schema,
                    on_invoke_tool=_placeholder,
                    strict_json_schema=False,
                )
            )
    return tools


def _patch_tools_to_capture(agent, captured: list[CallRecord]) -> None:
    """Replace each FunctionTool.on_invoke_tool with a capturing stub.

    The model still sees the tool's name, description, and JSON schema —
    those drive the routing decision, which is what we score. The stub
    captures the call and returns the canned value above, all without
    touching the real DB or any HTTP egress.
    """
    for tool in agent.tools:
        tool_name = tool.name
        stub_value = _stub_return_for(tool_name)

        async def _capture(_ctx, raw_args_json: str, *, _name=tool_name, _value=stub_value):
            try:
                parsed = json.loads(raw_args_json) if raw_args_json else {}
            except (ValueError, TypeError):
                parsed = {"_raw": raw_args_json}
            if not isinstance(parsed, dict):
                parsed = {"_value": parsed}
            captured.append(CallRecord(_name, parsed))
            if isinstance(_value, str):
                return _value
            return json.dumps(_value)

        tool.on_invoke_tool = _capture


# ---------------------------------------------------------------------------
# Per-case run
# ---------------------------------------------------------------------------


async def run_case(case: dict[str, Any], model: str | None) -> tuple[bool, str, list[CallRecord]]:
    """Run one case. Returns (passed, message, captured_calls)."""
    # Imports inside the function so a stub-mode skip path doesn't drag the
    # full agent stack in unnecessarily.
    from agents import RunConfig, Runner

    from chippi import make_chippi_agent
    from llm import resolve_chat_model
    from security.context import AgentContext

    connected = case["context"].get("connected_toolkits", []) or []

    workspace_info = (
        "# Your workspace\n"
        "- Workspace: Eval Workspace (slug: eval)\n"
        "- Intake link (share with new leads): https://eval.stub.invalid/apply/eval\n"
        f"- Connected integrations: {', '.join(sorted(connected)) if connected else '(none)'}\n"
        "- Include the intake link in any contact-facing draft where it makes sense."
    )

    # When the case wires up toolkits, synthesize the SAME tool surface the
    # prod loader (integrations.load_integration_tools) would build: the
    # curated FunctionTools for each toolkit's top-N actions PLUS the
    # find/call dispatcher fallback. We skip the HTTP schema fetch — for
    # routing assertions we only need the tool NAME to be visible to the
    # model; the JSON schema can be a permissive empty-object.
    extra_tools: list = []
    if connected:
        from tools.integrations_dispatcher import (
            call_integration_tool,
            find_integration_tool,
        )
        extra_tools = _build_synthetic_curated_tools(connected) + [
            find_integration_tool,
            call_integration_tool,
        ]

    chippi = make_chippi_agent(
        workspace_info=workspace_info,
        extra_tools=extra_tools,
        model=resolve_chat_model(model),
    )

    # Drop the input guardrail — it queries Supabase for pending drafts,
    # which would fail under stubbed DB. Routing decisions don't need it.
    chippi.input_guardrails = []

    captured: list[CallRecord] = []
    _patch_tools_to_capture(chippi, captured)

    ctx = AgentContext(
        space_id="s_eval",
        space_name="Eval Workspace",
        daily_token_budget=1_000_000,
        run_id=f"eval-{uuid.uuid4().hex[:8]}",
        user_id="u_eval",
    )

    # Tight turn cap — we want the first routing decision, not a multi-turn
    # play. Most cases settle in 1–4 turns.
    run_config = RunConfig(tracing_disabled=True)

    try:
        await Runner.run(
            chippi,
            input=case["prompt"],
            context=ctx,
            max_turns=10,
            run_config=run_config,
        )
    except Exception as exc:
        # A model error (rate limit, bad slug) is an infra problem, not a
        # case failure. Surface it but don't lose the captured calls so far.
        return (False, f"runtime error: {type(exc).__name__}: {exc}", captured)

    return _score_case(case, captured)


def _score_case(
    case: dict[str, Any], captured: list[CallRecord]
) -> tuple[bool, str, list[CallRecord]]:
    """Score the captured tool-call sequence against the case's expected spec."""
    expected = case["expected"]
    failures: list[str] = []

    seen = [c.tool for c in captured]
    seen_set = set(seen)

    for required in expected.get("tool_calls_must_include", []):
        if required not in seen_set:
            failures.append(f"missing required call: {required}")

    # tool_calls_must_include_any_of is a disjunction — at least one tool
    # from each named group must fire. Useful when the architecture allows
    # multiple valid routings for the same intent (e.g. a curated named
    # tool vs the fallback dispatcher).
    for group in expected.get("tool_calls_must_include_any_of", []):
        if not isinstance(group, list) or not group:
            continue
        if not any(name in seen_set for name in group):
            failures.append(
                f"missing required call: none of {group} fired"
            )

    for forbidden in expected.get("tool_calls_must_not_include", []):
        if forbidden in seen_set:
            failures.append(f"forbidden call fired: {forbidden}")

    must_pass_arg = expected.get("must_pass_arg", {})
    for tool_name, required_args in must_pass_arg.items():
        calls_to_tool = [c for c in captured if c.tool == tool_name]
        if not calls_to_tool:
            # The must-include check above already reports this — no double-log.
            continue
        for arg_name in required_args:
            seen_with_arg = any(
                _arg_present(call.args, arg_name) for call in calls_to_tool
            )
            if not seen_with_arg:
                failures.append(
                    f"{tool_name} fired but no call passed required arg '{arg_name}'"
                )

    must_query_match = expected.get("must_query_match", {})
    for tool_name, needles in must_query_match.items():
        calls_to_tool = [c for c in captured if c.tool == tool_name]
        if not calls_to_tool:
            continue
        needles_lower = [n.lower() for n in needles]
        matched = any(
            isinstance(call.args.get("query"), str)
            and any(n in call.args["query"].lower() for n in needles_lower)
            for call in calls_to_tool
        )
        if not matched:
            queries = [str(c.args.get("query", "")) for c in calls_to_tool]
            failures.append(
                f"{tool_name} query did not match any of {needles} — got {queries}"
            )

    max_calls = expected.get("max_tool_calls")
    if max_calls is not None and len(captured) > max_calls:
        failures.append(f"too many tool calls: {len(captured)} > {max_calls}")

    if failures:
        return (False, "; ".join(failures), captured)
    return (True, "ok", captured)


def _arg_present(args: dict[str, Any], key: str) -> bool:
    """An arg counts as 'passed' if it's in the dict AND non-empty."""
    if key not in args:
        return False
    value = args[key]
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    return True


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _provider_key_present() -> tuple[bool, str]:
    """Whether at least one LLM provider key is configured."""
    if os.environ.get("OPENROUTER_API_KEY"):
        return True, "OpenRouter"
    if os.environ.get("OPENAI_API_KEY"):
        return True, "OpenAI"
    return False, ""


async def main() -> int:
    parser = argparse.ArgumentParser(description="Chippi tool-routing eval runner")
    parser.add_argument(
        "--model",
        default=None,
        help="Override the LLM slug (default: workspace default via resolve_chat_model)",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Run only the case with this id (substring match)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail with exit 1 even when the provider key is missing (default: skip).",
    )
    args = parser.parse_args()

    have_key, provider = _provider_key_present()
    if not have_key:
        if args.strict:
            print(
                "FATAL: --strict set but neither OPENROUTER_API_KEY nor OPENAI_API_KEY is in env",
                file=sys.stderr,
            )
            return 1
        print(
            "SKIP: no OPENROUTER_API_KEY or OPENAI_API_KEY in env — "
            "eval needs a real LLM to score routing decisions. Set one and re-run.\n"
            "  (exit 0 so this is safe in pre-commit / pre-push hooks)"
        )
        return 0

    print(f"Using provider: {provider}")

    if not CASES_PATH.exists():
        print(f"FATAL: cases.json not found at {CASES_PATH}", file=sys.stderr)
        return 1

    with CASES_PATH.open() as fh:
        data = json.load(fh)
    cases = data.get("cases", [])
    if args.only:
        cases = [c for c in cases if args.only in c.get("id", "")]
        if not cases:
            print(f"FATAL: --only={args.only} matched no cases", file=sys.stderr)
            return 1

    print(f"Running {len(cases)} case(s)...\n")

    passed = 0
    failed = 0
    failures: list[tuple[dict, str, list[CallRecord]]] = []

    for case in cases:
        case_id = case.get("id", "<unknown>")
        sys.stdout.write(f"  {case_id}... ")
        sys.stdout.flush()
        try:
            ok, msg, captured = await run_case(case, args.model)
        except Exception as exc:
            ok = False
            msg = f"harness crash: {type(exc).__name__}: {exc}"
            captured = []
            traceback.print_exc()

        if ok:
            passed += 1
            print(f"PASS  ({len(captured)} call{'s' if len(captured) != 1 else ''})")
        else:
            failed += 1
            print(f"FAIL  — {msg}")
            failures.append((case, msg, captured))

    print()
    print(f"  Summary: PASS {passed}/{len(cases)}, FAIL {failed}/{len(cases)}")
    print()

    if failures:
        print("─── Failure details ───")
        for case, msg, captured in failures:
            print()
            print(f"  Case:    {case['id']}")
            print(f"  Prompt:  {case['prompt']!r}")
            print(f"  Failure: {msg}")
            print(f"  Tools called ({len(captured)}):")
            if not captured:
                print("    (none)")
            for record in captured:
                arg_keys = sorted(record.args.keys())
                print(f"    - {record.tool}({', '.join(arg_keys) or '<no args>'})")
            print(f"  Expected: {json.dumps(case['expected'])}")
        print()

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
