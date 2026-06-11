/**
 * Post-call scoring for mock sales calls.
 *
 * Two layers, cleanly split so the parser is testable without a network:
 *
 *   - parseScore(raw) — PURE. Takes whatever the model returned (a JSON string,
 *     a pre-parsed object, JSON wrapped in ```fences```, or garbage) and either
 *     produces a clean `MockCallScore` or returns null. Every rubric number is
 *     coerced + clamped to 0-100; tips/quotes are trimmed and capped. The model
 *     is the untrusted boundary here, so this never throws.
 *
 *   - scoreCall(openai, icp, transcript) — runs the grader LLM with the prompts
 *     from prompts.ts and feeds the result through parseScore. Returns null on
 *     transport failure or unparseable output so the caller (session.endSession)
 *     can degrade gracefully rather than 500.
 */

import type OpenAI from 'openai';
import type { Icp } from './icp';
import type { Transcript } from './session';
import {
  RUBRIC_DIMENSIONS,
  type RubricDimension,
  buildScoringSystemPrompt,
  buildScoringUserPrompt,
} from './prompts';

// ── Types ────────────────────────────────────────────────────────────────────

export type Rubric = Record<RubricDimension, number>;

/** The parsed, sanitized coaching result persisted to `MockCall.feedback`
 *  (with `overall` mirrored to `MockCall.score`). */
export interface MockCallScore {
  rubric: Rubric;
  overall: number;
  tips: string[];
  best_moment: string;
  worst_moment: string;
}

const MAX_TIPS = 3;
const MAX_TIP_LEN = 280;
const MAX_QUOTE_LEN = 400;

// ── Pure parsing / sanitization ──────────────────────────────────────────────

/** Coerce any value into a 0-100 integer score. Non-numbers and NaN → 0;
 *  out-of-range values clamp. Accepts numeric strings ("85") for forgiving
 *  model output. */
function clampScore(value: unknown): number {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number(value);
  } else {
    n = NaN;
  }
  if (!Number.isFinite(n)) return 0;
  n = Math.round(n);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function clampQuote(value: unknown): string {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  return t.length > MAX_QUOTE_LEN ? `${t.slice(0, MAX_QUOTE_LEN - 1).trimEnd()}…` : t;
}

function clampTips(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t.length > MAX_TIP_LEN ? `${t.slice(0, MAX_TIP_LEN - 1).trimEnd()}…` : t);
    if (out.length >= MAX_TIPS) break;
  }
  return out;
}

/**
 * Pull a JSON object out of a raw model string. Handles three common shapes the
 * model emits even when told to return bare JSON:
 *   - clean JSON,
 *   - JSON wrapped in ```json … ``` fences,
 *   - JSON with leading/trailing prose around a single {...} block.
 * Returns the parsed value or null. Never throws.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Try the whole thing first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // Strip code fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Last resort: grab the first {...} span.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Parse + sanitize a raw grader result into a `MockCallScore`, or null if it
 * can't be salvaged. Accepts a string (parsed defensively) or an already-parsed
 * object. PURE and total — the whole point is that malformed model output never
 * crashes the end-call path.
 *
 * A result is only rejected (null) when there is no usable object at all. A
 * partial object (some rubric keys missing) is accepted with the missing pieces
 * defaulted to 0 / '' — a half-graded call still beats a hard failure.
 */
export function parseScore(raw: unknown): MockCallScore | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    parsed = extractJson(raw);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const rubricRaw =
    obj.rubric && typeof obj.rubric === 'object' && !Array.isArray(obj.rubric)
      ? (obj.rubric as Record<string, unknown>)
      : {};

  const rubric = {} as Rubric;
  for (const dim of RUBRIC_DIMENSIONS) {
    rubric[dim] = clampScore(rubricRaw[dim]);
  }

  // overall: trust the model's number if present, else fall back to the rubric
  // mean so the score card always has a headline figure.
  const overall =
    obj.overall !== undefined && obj.overall !== null
      ? clampScore(obj.overall)
      : Math.round(
          RUBRIC_DIMENSIONS.reduce((sum, d) => sum + rubric[d], 0) / RUBRIC_DIMENSIONS.length,
        );

  return {
    rubric,
    overall,
    tips: clampTips(obj.tips),
    best_moment: clampQuote(obj.best_moment),
    worst_moment: clampQuote(obj.worst_moment),
  };
}

// ── LLM grader ───────────────────────────────────────────────────────────────

/** Model used for grading. A small, fast model is plenty for a rubric pass and
 *  keeps the end-call latency low; resolved to the active provider's slug. */
export const SCORING_MODEL = 'gpt-4.1-mini';

/**
 * Run the coaching grader over a finished mock call. Returns a sanitized
 * `MockCallScore`, or null if the transcript is empty, the model call fails, or
 * the output can't be parsed. The caller is responsible for auth/rate-limit
 * gates; this is pure orchestration over an injected OpenAI client (so tests
 * pass a stub and never hit the network).
 */
export async function scoreCall(
  openai: OpenAI,
  icp: Icp,
  transcript: Transcript,
  opts: { model?: string } = {},
): Promise<MockCallScore | null> {
  // Nothing the rep said → nothing to grade.
  const repTurns = (transcript ?? []).filter((t) => t.role === 'rep' && t.content.trim());
  if (repTurns.length === 0) return null;

  let text: string;
  try {
    const completion = await openai.chat.completions.create({
      model: opts.model ?? SCORING_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildScoringSystemPrompt() },
        { role: 'user', content: buildScoringUserPrompt(icp, transcript) },
      ],
    });
    text = completion.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    // Transport / provider failure — let the caller surface it without losing
    // the transcript. Score stays null; the call can be re-graded later.
    return null;
  }

  if (!text) return null;
  return parseScore(text);
}
