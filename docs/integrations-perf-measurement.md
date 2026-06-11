# Integrations latency — curated fast-path measurement

## What changed

`load_integration_tools()` now returns BOTH:

1. **Curated FunctionTools** — pre-built wrappers for the top 5-8
   most-used actions on each connected toolkit (see
   `agent/integrations_curated.py`). One LLM hop, one HTTP round trip
   per call.
2. **Dispatcher tools** — `find_integration_tool` + `call_integration_tool`,
   unchanged. Two LLM hops + two HTTP round trips per call. Stays as
   fallback for actions not in the curated allowlist.

Hard cap on total tools (native + curated + dispatcher): **100**.
xAI's ceiling is 200; the cap is a guard rail with margin. The cap is
enforced in `load_integration_tools` by trimming the curated slug list
before schema fetch, not by failing late.

A realtor with Gmail + HubSpot + Slack + Google Calendar connected
loads: 33 native + 24 curated (6+6+5+6 across those four toolkits) + 2
dispatcher = **59 total tools**. Plenty of headroom.

## Hypothesis being tested

Pre-loading curated actions saves ~3-5 seconds per integration call by
eliminating the dispatcher's intermediate LLM turn:

- Dispatcher path: model decides → `find_integration_tool` (LLM hop +
  HTTP) → model reads results → `call_integration_tool` (LLM hop +
  HTTP) → result.
- Curated path: model decides → curated tool (LLM hop + HTTP) → result.

The trade is prompt-token cost (each curated tool definition lives in
the system prompt every turn) versus saved wall-clock latency when
actions in the allowlist get used. If the model wastes turns picking
the wrong pre-loaded tool, the trade goes negative.

## What to log

Logs already shipped:

- `agent/integrations.py` — `integration_tools_loaded` on agent build
  with `curated_count`, `curated_requested`, `dispatcher_count`,
  `total`, `connected_toolkits`. Tells us the realistic per-realtor
  tool count.
- `agent/integrations.py:_build_curated_tool` — `curated_call_invoked`
  fires on every curated FunctionTool execution with `slug`, `toolkit`,
  `tool_name`.
- `agent/tools/integrations_dispatcher.py` — `find_integration_tool_results`
  and `call_integration_tool_invoked` fire on every dispatcher call.

Each emits `space_id` so we can aggregate per workspace or per turn (a
turn is bounded by the SSE stream open/close on `chat_turn`; group log
events by `space_id` + 5-minute bucket as a cheap turn proxy until we
add an explicit `turn_id`).

## What to measure after one week of prod traffic

Compute per (space_id, day):

- **`curated_call_count`** — number of `curated_call_invoked` events.
- **`dispatcher_call_count`** — number of `call_integration_tool_invoked`
  events (NOT `find_integration_tool_results` — `find` without a
  matching `call` means the model gave up; count those separately as
  `dispatcher_search_only_count`).
- **`avg_turn_latency_ms`** — wall-clock from `chat_turn` open to
  `done` SSE event (or to the last token of the model's reply).

Bucket workspaces into three groups by `curated_call_count /
(curated_call_count + dispatcher_call_count)`:

- **Curated-heavy**: ≥80% curated.
- **Mixed**: 20%-80%.
- **Dispatcher-heavy**: ≤20%.

Compare `avg_turn_latency_ms` across the buckets.

## What to do with the result

- **Curated wins by >2s on average** → expand the allowlist. Add 2-3
  more slugs per toolkit (cap each at 10 to stay under the budget).
  Re-measure after a week.
- **Curated wins by 0.5-2s** → leave the allowlist alone, but consider
  curating slugs for the toolkits we skipped (twilio,
  outlook_calendar — both 404'd on docs at audit time; revisit their
  current state on docs.composio.dev).
- **Curated wins by <0.5s** → the model isn't really using the fast
  path; check whether the prompt is steering it to dispatcher even when
  a curated tool fits. Likely a chippi.py prompt fix.
- **Dispatcher wins** → either (a) the model wastes turns choosing the
  wrong pre-loaded tool from a too-long list, or (b) prompt-token cost
  of curated definitions is dominating. Shrink the allowlist to the 3-4
  highest-confidence slugs per toolkit and re-measure.

The decision threshold is **net realtor-perceived latency** —
prompt-token cost rolls into model latency anyway, so the
`avg_turn_latency_ms` number captures both directions of the tradeoff
without needing a separate token accounting.

## How to run the measurement

```sql
-- Modal exports structlog as JSON to its log store; pipe to BigQuery
-- (or wherever the Modal export lands) and query like:
WITH calls AS (
  SELECT
    space_id,
    DATE_TRUNC(timestamp, DAY) AS day,
    COUNTIF(event = 'curated_call_invoked') AS curated,
    COUNTIF(event = 'call_integration_tool_invoked') AS dispatcher,
    COUNTIF(event = 'find_integration_tool_results') AS search_only
  FROM modal_logs
  WHERE event IN (
    'curated_call_invoked',
    'call_integration_tool_invoked',
    'find_integration_tool_results'
  )
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  GROUP BY space_id, day
),
turns AS (
  SELECT
    space_id,
    DATE_TRUNC(timestamp, DAY) AS day,
    APPROX_QUANTILES(turn_latency_ms, 100)[OFFSET(50)] AS p50_latency,
    APPROX_QUANTILES(turn_latency_ms, 100)[OFFSET(95)] AS p95_latency
  FROM modal_logs
  WHERE event = 'chat_turn_finished'
  GROUP BY space_id, day
)
SELECT
  c.day,
  CASE
    WHEN c.curated * 1.0 / NULLIF(c.curated + c.dispatcher, 0) >= 0.8 THEN 'curated_heavy'
    WHEN c.curated * 1.0 / NULLIF(c.curated + c.dispatcher, 0) <= 0.2 THEN 'dispatcher_heavy'
    ELSE 'mixed'
  END AS bucket,
  COUNT(DISTINCT c.space_id) AS spaces,
  AVG(t.p50_latency) AS avg_p50_latency_ms,
  AVG(t.p95_latency) AS avg_p95_latency_ms
FROM calls c
LEFT JOIN turns t USING (space_id, day)
GROUP BY c.day, bucket
ORDER BY c.day, bucket;
```

If `chat_turn_finished` with `turn_latency_ms` isn't emitted yet, add a
single line in `agent/modal_app.py:chat_turn` right before the final
`done` SSE event — `logger.info("chat_turn_finished", space_id=...,
turn_latency_ms=int((time.monotonic() - t0) * 1000))` — and let it
build a week of data before running the query.

## Why this measurement plan and not benchmarks

A microbenchmark of one curated call vs. one dispatcher call would
show the curated path is faster by exactly the LLM-turn cost of a
dispatcher hop (~1-3s on most chat models). That's not the interesting
number. The interesting number is whether the realtor's chats — which
are a mix of curated-fittable and long-tail actions — feel faster in
aggregate. Only production traffic tells us that.
