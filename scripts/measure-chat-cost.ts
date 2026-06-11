/**
 * measure-chat-cost — Phase 4 production baseline.
 *
 * Phases 1–3 of the agent-cost work cut token estimates. This script
 * tells us what we ACTUALLY shipped by reading the last 7 days of
 * `ChatUsage` rows from production and rolling up:
 *
 *   1. Overall totals (turns, input/output/cached tokens, cache hit
 *      rate, total $USD).
 *   2. Per-provider breakdown — anthropic | openai | xai | google |
 *      deepseek | moonshotai | qwen | unknown — sorted by total tokens.
 *   3. Per-model top 10 by total tokens.
 *   4. Outliers — top 10 turns by `promptTokens + completionTokens`.
 *      Catches the pathological prompts that distort averages.
 *   5. Distribution — p50 / p95 / p99 for input tokens, overall and
 *      for the providers we expect to dominate (anthropic, openai, xai).
 *
 * Read-only. SELECT only — no INSERT/UPDATE/DELETE, no migrations,
 * no production-code edits. The output is BOTH printed to console
 * and written to /tmp/chat-cost-report-{ISO timestamp}.md so it can
 * be pasted into a PR comment.
 *
 * How to run:
 *
 *   pnpm dlx tsx scripts/measure-chat-cost.ts
 *
 * Requires env vars (read by lib/supabase.ts):
 *
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Without them the script throws immediately with a clear message.
 * The service role key bypasses RLS so we see every space's data —
 * we are measuring the system, not one realtor.
 *
 * Why a script and not a route: we want the output BEFORE deciding
 * which Phase 4 PRs (B–E) to ship. A CLI script keeps the analysis
 * out of the product surface and the prod code path.
 *
 * NOTE on columns: the migration uses `promptTokens` / `completionTokens`
 * (not `inputTokens` / `outputTokens`). The report labels them as
 * "input"/"output" because that's the language realtors and the API
 * docs use.
 */

import { writeFileSync } from 'node:fs';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────
interface ChatUsageRow {
  id: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number | string; // numeric(10,6) comes back as string from PostgREST
  createdAt: string;
}

interface ProviderRollup {
  provider: string;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
}

interface ModelRollup {
  model: string;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Pull every ChatUsage row in [since, now] in 1000-row pages. PostgREST
 * caps a single response at 1000 by default; for 7 days of production
 * traffic we will overflow that. `.range(from, to)` is inclusive on both
 * ends.
 */
async function fetchAllRows(sinceIso: string): Promise<ChatUsageRow[]> {
  const PAGE = 1000;
  const out: ChatUsageRow[] = [];
  let from = 0;

  // Hard cap on the loop in case something pathological returns a full
  // page forever — at 50 pages we've already pulled 50k rows, more than
  // a week of healthy traffic.
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('ChatUsage')
      .select('id, model, provider, promptTokens, completionTokens, cachedTokens, costUsd, createdAt')
      .gte('createdAt', sinceIso)
      .order('createdAt', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`ChatUsage select failed: ${error.message}`);
    const rows = (data ?? []) as ChatUsageRow[];
    out.push(...rows);
    if (rows.length < PAGE) break; // last page
    from += PAGE;
  }

  return out;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  // Nearest-rank — good enough for a measurement script.
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function fmtIso(s: string): string {
  // Trim to minute precision so the column doesn't wrap.
  return s.slice(0, 16).replace('T', ' ');
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceIso = sevenDaysAgo.toISOString();
  const nowIso = now.toISOString();

  console.error(`Fetching ChatUsage rows since ${sinceIso}...`);
  const rows = await fetchAllRows(sinceIso);
  console.error(`Fetched ${rows.length} rows.`);

  // ── Coerce types — costUsd is numeric, PostgREST returns string ──
  const normalized = rows.map((r) => ({
    ...r,
    costUsd: typeof r.costUsd === 'string' ? Number(r.costUsd) : r.costUsd,
    promptTokens: r.promptTokens ?? 0,
    completionTokens: r.completionTokens ?? 0,
    cachedTokens: r.cachedTokens ?? 0,
    provider: r.provider ?? 'unknown',
    model: r.model ?? 'unknown',
  }));

  // ── Overall totals ──
  const turns = normalized.length;
  const totalPrompt = normalized.reduce((s, r) => s + r.promptTokens, 0);
  const totalCompletion = normalized.reduce((s, r) => s + r.completionTokens, 0);
  const totalCached = normalized.reduce((s, r) => s + r.cachedTokens, 0);
  const totalCost = normalized.reduce((s, r) => s + (r.costUsd as number), 0);

  // ── Per-provider rollup ──
  const providerMap = new Map<string, ProviderRollup>();
  for (const r of normalized) {
    const existing = providerMap.get(r.provider) ?? {
      provider: r.provider,
      turns: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
    };
    existing.turns += 1;
    existing.promptTokens += r.promptTokens;
    existing.completionTokens += r.completionTokens;
    existing.cachedTokens += r.cachedTokens;
    existing.costUsd += r.costUsd as number;
    providerMap.set(r.provider, existing);
  }
  const providers = [...providerMap.values()].sort(
    (a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens),
  );

  // ── Per-model rollup (top 10) ──
  const modelMap = new Map<string, ModelRollup>();
  for (const r of normalized) {
    const existing = modelMap.get(r.model) ?? {
      model: r.model,
      turns: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    };
    existing.turns += 1;
    existing.promptTokens += r.promptTokens;
    existing.completionTokens += r.completionTokens;
    existing.costUsd += r.costUsd as number;
    modelMap.set(r.model, existing);
  }
  const topModels = [...modelMap.values()]
    .sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens))
    .slice(0, 10);

  // ── Outliers — top 10 turns by total tokens ──
  const outliers = [...normalized]
    .sort(
      (a, b) =>
        (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens),
    )
    .slice(0, 10);

  // ── Distributions ──
  const allInputSorted = [...normalized].map((r) => r.promptTokens).sort((a, b) => a - b);
  const anthropicSorted = normalized
    .filter((r) => r.provider === 'anthropic')
    .map((r) => r.promptTokens)
    .sort((a, b) => a - b);
  const openaiSorted = normalized
    .filter((r) => r.provider === 'openai')
    .map((r) => r.promptTokens)
    .sort((a, b) => a - b);
  const xaiSorted = normalized
    .filter((r) => r.provider === 'xai')
    .map((r) => r.promptTokens)
    .sort((a, b) => a - b);

  // ── Observations — short, computed from the data ──
  const observations: string[] = [];
  if (turns === 0) {
    observations.push('No ChatUsage rows in the last 7 days — either the table is empty, the env points at a non-prod DB, or the writers are not landing rows.');
  } else {
    const overallHit = totalPrompt > 0 ? (totalCached / totalPrompt) * 100 : 0;
    observations.push(
      `Overall cache hit rate is ${overallHit.toFixed(1)}% across ${fmtInt(turns)} turns — Phase 2 caching ${overallHit >= 30 ? 'is paying off' : 'has not landed yet'}.`,
    );
    const anthro = providers.find((p) => p.provider === 'anthropic');
    if (anthro && anthro.promptTokens > 0) {
      const hit = (anthro.cachedTokens / anthro.promptTokens) * 100;
      observations.push(
        `Anthropic hit rate: ${hit.toFixed(1)}% over ${fmtInt(anthro.turns)} turns. p50 input = ${fmtInt(percentile(anthropicSorted, 50))} tokens.`,
      );
    }
    const xai = providers.find((p) => p.provider === 'xai');
    if (xai && anthro && xai.turns > 0 && anthro.turns > 0) {
      const xaiAvgCost = xai.costUsd / xai.turns;
      const anthroAvgCost = anthro.costUsd / anthro.turns;
      if (anthroAvgCost > 0) {
        const ratio = xaiAvgCost / anthroAvgCost;
        observations.push(
          `xAI cost per turn (${fmtUsd(xaiAvgCost)}) is ${ratio.toFixed(1)}x Anthropic's (${fmtUsd(anthroAvgCost)}) — no caching path on OpenRouter for Grok.`,
        );
      }
    }
    if (outliers.length > 0) {
      const top = outliers[0];
      observations.push(
        `Top outlier: ${fmtInt(top.promptTokens)} input + ${fmtInt(top.completionTokens)} output tokens at ${fmtUsd(Number(top.costUsd))} on ${top.model} (${fmtIso(top.createdAt)}).`,
      );
    }
  }

  // ── Render markdown ──
  const lines: string[] = [];
  lines.push('# Chat cost report — last 7 days');
  lines.push('');
  lines.push(`Generated: ${nowIso}`);
  lines.push(`Period: ${sinceIso} to ${nowIso}`);
  lines.push(`Rows scanned: ${fmtInt(rows.length)}`);
  lines.push('');

  lines.push('## Overall');
  if (turns === 0) {
    lines.push('- No rows in window.');
  } else {
    lines.push(`- Turns: ${fmtInt(turns)}`);
    lines.push(
      `- Input tokens: ${fmtTokens(totalPrompt)} (avg ${fmtInt(Math.round(totalPrompt / turns))}/turn)`,
    );
    lines.push(
      `- Output tokens: ${fmtTokens(totalCompletion)} (avg ${fmtInt(Math.round(totalCompletion / turns))}/turn)`,
    );
    lines.push(
      `- Cached tokens: ${fmtTokens(totalCached)} (cache hit rate: ${fmtPct(totalCached, totalPrompt)})`,
    );
    lines.push(`- Total cost: ${fmtUsd(totalCost)}`);
  }
  lines.push('');

  lines.push('## Per-provider');
  if (providers.length === 0) {
    lines.push('- No provider data.');
  } else {
    lines.push('| Provider | Turns | Avg input | Avg output | Cache hit | Cost |');
    lines.push('|---|---|---|---|---|---|');
    for (const p of providers) {
      const avgIn = p.turns > 0 ? Math.round(p.promptTokens / p.turns) : 0;
      const avgOut = p.turns > 0 ? Math.round(p.completionTokens / p.turns) : 0;
      lines.push(
        `| ${p.provider} | ${fmtInt(p.turns)} | ${fmtInt(avgIn)} | ${fmtInt(avgOut)} | ${fmtPct(p.cachedTokens, p.promptTokens)} | ${fmtUsd(p.costUsd)} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Per-model (top 10 by total tokens)');
  if (topModels.length === 0) {
    lines.push('- No model data.');
  } else {
    lines.push('| Model | Turns | Avg input | Avg output | Cost |');
    lines.push('|---|---|---|---|---|');
    for (const m of topModels) {
      const avgIn = m.turns > 0 ? Math.round(m.promptTokens / m.turns) : 0;
      const avgOut = m.turns > 0 ? Math.round(m.completionTokens / m.turns) : 0;
      lines.push(
        `| ${m.model} | ${fmtInt(m.turns)} | ${fmtInt(avgIn)} | ${fmtInt(avgOut)} | ${fmtUsd(m.costUsd)} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Outliers (top 10 by total tokens)');
  if (outliers.length === 0) {
    lines.push('- No outliers.');
  } else {
    lines.push('| When (UTC) | Model | Input | Output | Cost |');
    lines.push('|---|---|---|---|---|');
    for (const o of outliers) {
      lines.push(
        `| ${fmtIso(o.createdAt)} | ${o.model} | ${fmtInt(o.promptTokens)} | ${fmtInt(o.completionTokens)} | ${fmtUsd(Number(o.costUsd))} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Distribution (input tokens)');
  if (allInputSorted.length === 0) {
    lines.push('- No input data.');
  } else {
    lines.push(
      `- Overall: p50=${fmtInt(percentile(allInputSorted, 50))}, p95=${fmtInt(percentile(allInputSorted, 95))}, p99=${fmtInt(percentile(allInputSorted, 99))}`,
    );
    if (anthropicSorted.length > 0) {
      lines.push(
        `- Anthropic (n=${anthropicSorted.length}): p50=${fmtInt(percentile(anthropicSorted, 50))}, p95=${fmtInt(percentile(anthropicSorted, 95))}, p99=${fmtInt(percentile(anthropicSorted, 99))}`,
      );
    }
    if (openaiSorted.length > 0) {
      lines.push(
        `- OpenAI (n=${openaiSorted.length}): p50=${fmtInt(percentile(openaiSorted, 50))}, p95=${fmtInt(percentile(openaiSorted, 95))}, p99=${fmtInt(percentile(openaiSorted, 99))}`,
      );
    }
    if (xaiSorted.length > 0) {
      lines.push(
        `- xAI (n=${xaiSorted.length}): p50=${fmtInt(percentile(xaiSorted, 50))}, p95=${fmtInt(percentile(xaiSorted, 95))}, p99=${fmtInt(percentile(xaiSorted, 99))}`,
      );
    }
  }
  lines.push('');

  lines.push('## Observations');
  for (const obs of observations) {
    lines.push(`- ${obs}`);
  }
  lines.push('');

  const report = lines.join('\n');
  // Use a filesystem-friendly timestamp — colons in ISO break some shells.
  const fileStamp = nowIso.replace(/[:.]/g, '-');
  const outPath = `/tmp/chat-cost-report-${fileStamp}.md`;
  writeFileSync(outPath, report, 'utf8');

  // Console gets the same content. stderr for the status line above so
  // a caller can `> report.md` to capture just the report.
  process.stdout.write(report);
  console.error(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error('measure-chat-cost failed:', err);
  process.exit(1);
});
