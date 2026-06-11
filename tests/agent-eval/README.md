# Chippi agent eval — tool-routing regression net

A short offline check that catches the failure mode every recent fix has
re-introduced: **the model picks the wrong tool**.

"Send X@gmail.com a test email" should call `draft_message`. It started
calling `find_integration_tool` last week. The fix shipped. The next prompt
re-broke it. Nobody noticed until the realtor yelled.

This runner re-checks 28 hand-picked routing decisions in under a minute and
exits non-zero on regression — so you find out before merge, not after.

## What it catches

Tool-routing regressions only. Examples:

- Raw-email outreach falling back to the integration dispatcher
- Native CRM lookups (`find_contacts`) getting routed to HubSpot via the
  dispatcher
- "Read my Gmail" calling `draft_message` (the recipient/reader mix-up)
- Sweep prompts ("who haven't I followed up with") calling the wrong filter
- Ambiguous prompts firing tools instead of `ask_realtor`
- Greetings triggering a sweep loop
- Stage moves routing through `update_deal` instead of `advance_deal_stage`

What it does **not** catch: tool implementation bugs, integration auth,
prompt voice, the quality of the drafted email body. Use vitest +
`tests/lib/*` for that.

## How to run

```bash
# Default — uses your workspace's resolved model via OpenRouter
pnpm run agent:eval
# or
python tests/agent-eval/run.py

# Pin a specific model
python tests/agent-eval/run.py --model openai/gpt-5-mini

# Iterate on one case
python tests/agent-eval/run.py --only outreach-raw-email
```

## Gating

The runner needs a real LLM — that's the point. Set one of:

- `OPENROUTER_API_KEY` (preferred; mirrors the prod path)
- `OPENAI_API_KEY` (fallback; collapses model selection to `gpt-5`)

With neither set, the runner exits 0 with a SKIP notice. This makes it safe
to wire into pre-commit / pre-push hooks: a dev box without a key keeps
working; CI with the key catches regressions.

Pass `--strict` to fail (exit 1) on missing key — for the CI job that's
supposed to always run.

## How the offline part works

The runner builds a real Chippi agent — same `make_chippi_agent` call as
`modal_app.chat_turn` — with the case's `connected_toolkits` injected into
`workspace_info`. The model sees the full tool catalog (native tools + the
curated FunctionTools per connected toolkit + the dispatcher fallback) and
the real CHIPPI_INSTRUCTIONS prompt.

The curated tools (e.g. `gmail_send_email`, `googlecalendar_events_list`)
are synthesized locally from `integrations_curated.CURATED_ACTIONS` —
prod's loader fetches each action's JSON schema from Composio via HTTP,
the eval skips the fetch and gives the tools a permissive empty-object
schema. For routing assertions we only care that the model sees the right
*name* in its tool list.

Then, before `Runner.run`, every `FunctionTool.on_invoke_tool` gets replaced
with a capturing stub that:

1. Records the tool name and parsed arguments.
2. Returns a shape-correct canned value so the model can keep running
   without a "tool returned garbage" loop.

So the model *thinks* it called `draft_message`, but no Supabase write, no
Composio HTTP, no Resend send happens. We just record what it asked for.

This is the same pattern used by the openai-agents SDK's own tests — patch
the tool's invoker, not the LLM.

## Why a real LLM instead of a mock model

We tried both. A mock model only tests the harness — it can't surface a
prompt regression because the "model" is hand-scripted. Routing is a
*model decision*, so the eval has to ask the real model. Token cost: about
$0.005 per case at gpt-5-mini, ~$0.15 for the whole suite. Worth it.

## Why this lives outside vitest

`vitest` is TypeScript and runs against the Next.js side. Chippi is Python,
runs on Modal, and uses the openai-agents Python SDK. Driving the agent
from TS would mean re-implementing the prompt and tool registration in TS
— two sources of truth, drift guaranteed. Python eval against the same
Python code that ships to prod is the only way.

## When to run

Before merging any change that touches:

- `agent/chippi.py` (the system prompt or the tool list)
- `agent/tools/*` (tool descriptions, argument schemas)
- `agent/integrations.py` or `agent/tools/integrations_dispatcher.py`
- `agent/modal_app.py` workspace_info construction

Or whenever a realtor reports "Chippi did the wrong thing." Add a case
covering the failure shape; ship the fix; re-run; merge.

## Adding a new case

Open `cases.json`, append to `cases[]`:

```json
{
  "id": "short-kebab-id",
  "prompt": "the exact realtor utterance",
  "context": {"connected_toolkits": ["gmail"]},
  "expected": {
    "tool_calls_must_include": ["draft_message"],
    "tool_calls_must_not_include": ["find_integration_tool"],
    "must_pass_arg": {"draft_message": ["recipient_email"]},
    "max_tool_calls": 4
  },
  "rationale": "one line — why this case exists and what it would have caught"
}
```

Field reference (also in `cases.json` under `_field_help`):

- `tool_calls_must_include` — order-agnostic; every name must appear at
  least once in the run.
- `tool_calls_must_not_include` — hard fail if any name appears.
- `must_pass_arg` — for a tool name in `must_include`, at least one call
  to that tool must pass these arg keys with non-empty values.
- `must_query_match` — for `find_integration_tool` (or any tool with a
  `query` arg), the query string (lowercased) must contain at least one
  of the listed substrings on at least one call.
- `tool_calls_must_include_any_of` — disjunction. A list of lists; each
  inner list is a group, at least one tool from each group must fire.
  Use this when multiple routings are valid (e.g. the curated
  `gmail_send_email` OR the `find_integration_tool` fallback both work
  for "send a Gmail").
- `max_tool_calls` — cap on total calls. Catches loops and over-eager
  dispatch storms.

Keep the case set small and high-signal. 30 hand-picked failures-we-have-
hit beats 300 generated cases.

## Costs / runtime

- ~$0.005 per case at `openai/gpt-5-mini` (`pnpm run agent:eval`)
- ~20–40 seconds end-to-end on a stable connection
- One LLM call per case (max ~10 turns, usually 1–3)
