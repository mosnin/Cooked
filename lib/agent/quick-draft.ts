/**
 * Quick-draft compose engine — the shared OpenAI call that powers BOTH:
 *
 *   • POST /api/agent/quick-draft (preview mode) — the /chippi home's
 *     inline draft engine, the realtor's "Send a check-in" tap.
 *   • lib/ai-tools/tools/draft-{email,sms}.ts — the on-demand agent
 *     tools that the SDK chat loop calls during a turn.
 *
 * Both used to live in `app/api/agent/quick-draft/route.ts` and the two
 * tool wrappers imported `composeQuickDraft` from that route file. Next.js
 * 15.5 enforces that route files only export the runtime / config /
 * HTTP-verb symbols — `composeQuickDraft` and `composeDraftWithOpenAI`
 * trip the type-checker:
 *
 *   Type error: Route "app/api/agent/quick-draft/route.ts" does not match
 *   the required types of a Next.js Route.
 *     "composeQuickDraft" is not a valid Route export field.
 *
 * The compose machinery has no business in a route file anyway — it's
 * library code two places need. Lives here now; the route imports it
 * back, the tool wrappers import it directly.
 */

import { getLLMClient, hasLLMKey, openaiModel } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { enrichContext, type EnrichedContext } from '@/lib/ai-tools/context-enrichment';
import { getRecentVoiceSamples, type VoiceSample } from '@/lib/draft-voice';

const TIMEOUT_MS = 5_000;
const MODEL = 'gpt-5-mini';

export type Intent = 'check-in' | 'log-call' | 'welcome' | 'reach-out';
export type Context = 'deal' | 'person';
export type Channel = 'email' | 'sms' | 'note';

const SYSTEM_PROMPT =
  "You are Chippi, an AI assistant for a real-estate CRM. Compose ONE short outbound message the realtor can send right now. " +
  "Voice: warm, direct, human. No marketing fluff. Skip stale email openers and corporate filler. No subject lines longer than 8 words. " +
  "Email body: 2-4 sentences, plain text, no markdown, no signature (the realtor's name is appended downstream). " +
  "Note body (when channel is 'note'): a single line summarizing what was discussed on a call — past tense, factual. " +
  "Output strict JSON with this shape and nothing else: {\"subject\": string|null, \"body\": string}. " +
  "Subject is a non-empty string for emails, null for notes.";

/**
 * Build the optional voice-reference system message. Empty string if there
 * are no samples (caller skips the message entirely in that case). Bodies
 * arrive truncated from `getRecentVoiceSamples`; this formats them and pins
 * the don't-copy rule that is the actual PII defense.
 *
 * The instruction is the load-bearing piece — these samples were written to
 * other recipients, and the model must treat them as cadence-only. If this
 * sentence is wrong, names leak; no regex on the input will save us.
 */
function buildVoiceMessage(samples: VoiceSample[]): string {
  if (samples.length === 0) return '';
  const lines: string[] = [
    "The realtor's voice — recent emails they sent to OTHER people. Match cadence, sentence length, and word choice only.",
    "Do NOT address the new recipient by any name that appears in these samples. Do NOT mention any deal, property, address, date, or detail from these samples — those belong to other recipients and would be a privacy breach.",
    "Use only the new recipient's facts from the user message; the samples are tone reference, never content.",
    '',
  ];
  samples.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.body}`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

/**
 * Phase 16: exported so on-demand agent tools (`draft_email`, `draft_sms`)
 * reuse the same OpenAI call instead of duplicating the prompt + JSON parse.
 * Same shape, same model, same voice rules.
 */
export async function composeDraftWithOpenAI(args: {
  intent: Intent;
  channel: Channel;
  subjectLabel: string;
  recentActivity: string[];
  daysQuiet: number | null;
  stage?: string;
  status?: string;
  scoreLabel?: string | null;
  leadScore?: number | null;
  voiceSamples: VoiceSample[];
}): Promise<{ subject: string | null; body: string } | null> {
  if (!hasLLMKey()) return null;

  const userPayload = {
    intent: args.intent,
    channel: args.channel,
    subject: args.subjectLabel,
    daysSinceLastTouch: args.daysQuiet,
    recentActivity: args.recentActivity.slice(0, 6),
    stage: args.stage,
    status: args.status,
    scoreLabel: args.scoreLabel,
    leadScore: args.leadScore,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const client = getLLMClient();
    // Voice samples ride alongside SYSTEM_PROMPT, never replacing it. Empty
    // sample list → no second system message (current behavior preserved).
    const voiceMessage =
      args.channel === 'email' ? buildVoiceMessage(args.voiceSamples) : '';
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];
    if (voiceMessage) messages.push({ role: 'system', content: voiceMessage });
    messages.push({ role: 'user', content: JSON.stringify(userPayload) });

    const response = await client.chat.completions.create(
      {
        model: openaiModel(MODEL),
        temperature: 0.4,
        max_tokens: 220,
        response_format: { type: 'json_object' },
        messages,
      },
      { signal: controller.signal },
    );
    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { subject?: unknown; body?: unknown };
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    if (!body) return null;
    const subject =
      typeof parsed.subject === 'string' && parsed.subject.trim().length > 0
        ? parsed.subject.trim()
        : null;
    return { subject, body };
  } catch (err) {
    logger.warn('[quick-draft] compose failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Phase 16: one-call compose path for the on-demand agent's `draft_*` tools.
 *
 * Pure read — no AgentDraft row, no audit, no delivery. Mirrors the
 * preview-mode pipeline (enrichContext → optional voice samples → OpenAI),
 * but exposed as a function so the agent tools don't have to HTTP-call
 * themselves or duplicate the prompt.
 *
 * Returns null if the subject can't be enriched (unknown id) or if the
 * OpenAI call fails — callers translate that to a user-facing error.
 */
export async function composeQuickDraft(args: {
  kind: Context;
  id: string;
  intent: Intent;
  channel: Channel;
  spaceId: string;
}): Promise<{ subject: string | null; body: string; subjectLabel: string } | null> {
  const enriched: EnrichedContext | null = await enrichContext(
    { kind: args.kind, id: args.id },
    args.spaceId,
  );
  if (!enriched) return null;

  const voiceSamples =
    args.channel === 'email' ? await getRecentVoiceSamples(args.spaceId) : [];

  const composed = await composeDraftWithOpenAI({
    intent: args.intent,
    channel: args.channel,
    subjectLabel: enriched.subjectLabel,
    recentActivity: enriched.lastActivities,
    daysQuiet: enriched.daysSinceLastTouch,
    stage: enriched.stage,
    status: enriched.status,
    scoreLabel: enriched.scoreLabel,
    leadScore: enriched.leadScore,
    voiceSamples,
  });
  if (!composed) return null;

  return { ...composed, subjectLabel: enriched.subjectLabel };
}
