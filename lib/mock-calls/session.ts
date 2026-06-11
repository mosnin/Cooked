/**
 * Mock-call session orchestration.
 *
 * A MockCall is one practice session: the rep picks an ICP (+ optional
 * scenario), Axil role-plays that prospect turn by turn, and when the rep ends
 * the call Axil grades it. This module owns the lifecycle over the `MockCall`
 * table:
 *
 *   - createSession(icp, scenario)  → inserts a 'live' row with an empty transcript
 *   - addRepTurn(call, repMessage)  → appends the rep turn, calls the prospect
 *                                     LLM, appends the prospect reply, persists
 *   - endSession(call)              → grades the transcript, persists score/feedback,
 *                                     flips status to 'completed'
 *
 * Failure posture (the brief's hard requirement): if the prospect LLM fails
 * mid-call, the status STAYS 'live' and the error is surfaced to the caller —
 * the session is not abandoned and the rep's turn is not lost. If the grader
 * fails at end, the call is still marked 'completed' (the rep is done talking)
 * but with a null score, surfaced so the UI can offer a re-grade.
 *
 * Everything is space-scoped: every read/write filters by `spaceId`, and the
 * LLM client is injected so the unit tests never touch the network.
 */

import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Icp } from './icp';
import { getIcp } from './icp';
import { buildProspectSystemPrompt } from './prompts';
import { scoreCall, type MockCallScore } from './scoring';

// ── Types ────────────────────────────────────────────────────────────────────

export type TurnRole = 'rep' | 'prospect';

/** One line of the mock-call transcript. `at` is an ISO timestamp. */
export interface Turn {
  role: TurnRole;
  content: string;
  at: string;
}

export type Transcript = Turn[];

export type MockCallStatus = 'queued' | 'live' | 'completed' | 'abandoned';

/** A MockCall row as the API returns it. */
export interface MockCall {
  id: string;
  spaceId: string;
  userId: string | null;
  icpId: string | null;
  scenario: string | null;
  status: MockCallStatus;
  transcript: Transcript;
  score: number | null;
  feedback: MockCallScore | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const MOCK_CALL_COLUMNS =
  'id, spaceId, userId, icpId, scenario, status, transcript, score, feedback, startedAt, endedAt, createdAt, updatedAt';

const MAX_REP_MESSAGE = 4000;
/** The prospect model. Mid-tier is plenty for short in-character replies. */
export const PROSPECT_MODEL = 'gpt-4.1-mini';
/** Cap the turns we feed back to the model — a practice call is short, and this
 *  bounds token cost if a transcript somehow grows large. */
const MAX_CONTEXT_TURNS = 40;

// ── Row coercion ─────────────────────────────────────────────────────────────

/** Coerce a transcript JSONB value into a clean `Transcript`, dropping malformed
 *  turns. Defensive because the column is JSONB. */
export function normalizeTranscript(raw: unknown): Transcript {
  if (!Array.isArray(raw)) return [];
  const out: Transcript = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const role = t.role === 'prospect' ? 'prospect' : t.role === 'rep' ? 'rep' : null;
    if (!role) continue;
    if (typeof t.content !== 'string') continue;
    out.push({
      role,
      content: t.content,
      at: typeof t.at === 'string' ? t.at : new Date().toISOString(),
    });
  }
  return out;
}

function rowToMockCall(row: Record<string, unknown>): MockCall {
  return {
    id: row.id as string,
    spaceId: row.spaceId as string,
    userId: (row.userId as string | null) ?? null,
    icpId: (row.icpId as string | null) ?? null,
    scenario: (row.scenario as string | null) ?? null,
    status: row.status as MockCallStatus,
    transcript: normalizeTranscript(row.transcript),
    score: typeof row.score === 'number' ? row.score : row.score == null ? null : Number(row.score),
    feedback: (row.feedback as MockCallScore | null) ?? null,
    startedAt: row.startedAt as string,
    endedAt: (row.endedAt as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** List a space's mock calls, newest first. */
export async function listSessions(db: SupabaseClient, spaceId: string): Promise<MockCall[]> {
  const { data, error } = await db
    .from('MockCall')
    .select(MOCK_CALL_COLUMNS)
    .eq('spaceId', spaceId)
    .order('createdAt', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => rowToMockCall(r as Record<string, unknown>));
}

/** Fetch one mock call scoped to the space. Null when missing or another space's. */
export async function getSession(
  db: SupabaseClient,
  spaceId: string,
  callId: string,
): Promise<MockCall | null> {
  const { data, error } = await db
    .from('MockCall')
    .select(MOCK_CALL_COLUMNS)
    .eq('id', callId)
    .eq('spaceId', spaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToMockCall(data as Record<string, unknown>) : null;
}

// ── createSession ────────────────────────────────────────────────────────────

/**
 * Start a new mock call against `icp`. Inserts a 'live' row (the rep is about to
 * start talking) with an empty transcript. `scenario` is trimmed/capped.
 */
export async function createSession(
  db: SupabaseClient,
  args: {
    spaceId: string;
    userId: string;
    icp: Icp;
    scenario?: string | null;
  },
): Promise<MockCall> {
  const scenario =
    typeof args.scenario === 'string' && args.scenario.trim()
      ? args.scenario.trim().slice(0, 600)
      : null;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('MockCall')
    .insert({
      spaceId: args.spaceId,
      userId: args.userId,
      icpId: args.icp.id,
      scenario,
      status: 'live',
      transcript: [],
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .select(MOCK_CALL_COLUMNS)
    .single();
  if (error) throw error;
  return rowToMockCall(data as Record<string, unknown>);
}

// ── addRepTurn ───────────────────────────────────────────────────────────────

export type AddRepTurnResult =
  | { ok: true; call: MockCall; prospectReply: string }
  | { ok: false; error: string; code: 'empty' | 'not_live' | 'llm_failed' | 'icp_missing' };

/**
 * Append the rep's message, ask the prospect LLM for an in-character reply,
 * append that, and persist the grown transcript.
 *
 * Graceful failure: on an LLM transport error we DO NOT persist the rep turn or
 * change status — the call stays 'live' and we return `{ ok:false, code:'llm_failed' }`
 * so the UI can let the rep retry the same line. (Persisting a dangling rep turn
 * with no prospect reply would corrupt the alternating transcript.)
 */
export async function addRepTurn(
  db: SupabaseClient,
  openai: OpenAI,
  args: {
    call: MockCall;
    message: string;
    model?: string;
  },
): Promise<AddRepTurnResult> {
  const message = (args.message ?? '').trim();
  if (!message) return { ok: false, error: 'Say something to the prospect.', code: 'empty' };
  if (args.call.status !== 'live') {
    return { ok: false, error: 'This call has already ended.', code: 'not_live' };
  }

  // The ICP backs the prospect's character. If it was deleted mid-session
  // (FK set null), we can't roleplay faithfully — surface it cleanly.
  const icp = args.call.icpId
    ? await getIcp(db, args.call.spaceId, args.call.icpId)
    : null;
  if (!icp) {
    return {
      ok: false,
      error: 'The profile for this call is no longer available.',
      code: 'icp_missing',
    };
  }

  const repTurn: Turn = {
    role: 'rep',
    content: message.slice(0, MAX_REP_MESSAGE),
    at: new Date().toISOString(),
  };

  // Build the model conversation: prospect system prompt + the transcript so
  // far (rep → user, prospect → assistant) + the new rep line.
  const history = args.call.transcript.slice(-MAX_CONTEXT_TURNS);
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: buildProspectSystemPrompt(icp, args.call.scenario) },
    ...history.map((t) => ({
      role: (t.role === 'rep' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: t.content,
    })),
    { role: 'user', content: repTurn.content },
  ];

  let reply: string;
  try {
    const completion = await openai.chat.completions.create({
      model: args.model ?? PROSPECT_MODEL,
      temperature: 0.8, // a little life in the prospect
      max_tokens: 220, // 1-3 sentences — keep it call-paced
      messages,
    });
    reply = completion.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    // Stay live, lose nothing — the rep can resend.
    return {
      ok: false,
      error: 'The prospect went quiet — try that again in a moment.',
      code: 'llm_failed',
    };
  }

  if (!reply) {
    return {
      ok: false,
      error: 'The prospect went quiet — try that again in a moment.',
      code: 'llm_failed',
    };
  }

  const prospectTurn: Turn = {
    role: 'prospect',
    content: reply,
    at: new Date().toISOString(),
  };

  const nextTranscript = [...args.call.transcript, repTurn, prospectTurn];
  const { data, error } = await db
    .from('MockCall')
    .update({ transcript: nextTranscript, updatedAt: new Date().toISOString() })
    .eq('id', args.call.id)
    .eq('spaceId', args.call.spaceId)
    .select(MOCK_CALL_COLUMNS)
    .single();
  if (error) throw error;

  return { ok: true, call: rowToMockCall(data as Record<string, unknown>), prospectReply: reply };
}

// ── endSession ───────────────────────────────────────────────────────────────

export interface EndSessionResult {
  call: MockCall;
  /** Set when grading failed — the call is completed but ungraded, and the UI
   *  can surface this and offer a re-grade. Absent on success. */
  scoreError?: string;
}

/**
 * End the call and grade it. The call is always marked 'completed' (the rep
 * stopped talking — that's a terminal user action). Grading is best-effort:
 *
 *   - empty transcript → no grade, no error (nothing to coach).
 *   - grader succeeds   → persist score (overall) + feedback (full rubric).
 *   - grader fails      → completed with null score, `scoreError` surfaced.
 */
export async function endSession(
  db: SupabaseClient,
  openai: OpenAI,
  args: { call: MockCall; model?: string },
): Promise<EndSessionResult> {
  const { call } = args;
  const endedAt = new Date().toISOString();

  let score: MockCallScore | null = null;
  let scoreError: string | undefined;

  const hasRepTurn = call.transcript.some((t) => t.role === 'rep' && t.content.trim());
  if (hasRepTurn) {
    const icp = call.icpId ? await getIcp(db, call.spaceId, call.icpId) : null;
    if (icp) {
      score = await scoreCall(openai, icp, call.transcript, { model: args.model });
      if (!score) {
        scoreError = "Axil couldn't score this call right now. The transcript is saved — you can grade it again.";
      }
    } else {
      scoreError = 'The profile for this call is no longer available, so it could not be scored.';
    }
  }

  const { data, error } = await db
    .from('MockCall')
    .update({
      status: 'completed',
      endedAt,
      score: score ? score.overall : null,
      feedback: score ?? null,
      updatedAt: endedAt,
    })
    .eq('id', call.id)
    .eq('spaceId', call.spaceId)
    .select(MOCK_CALL_COLUMNS)
    .single();
  if (error) throw error;

  return { call: rowToMockCall(data as Record<string, unknown>), scoreError };
}
