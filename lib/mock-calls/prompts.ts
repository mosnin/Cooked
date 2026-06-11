/**
 * Prompt builders for Axil's mock sales calls.
 *
 * Two prompts, both pure functions of an ICP (+ scenario / transcript):
 *
 *   1. buildProspectSystemPrompt — Axil plays the PROSPECT. It reads the ICP's
 *      persona and instructs the model to stay in character: raise THIS ICP's
 *      objections, match its temperament, talk like a real person on a call
 *      (1-3 sentences), and never break character or coach mid-call.
 *
 *   2. buildScoringPrompt — after the call, Axil grades the REP against a fixed
 *      coaching rubric (discovery, objection handling, value articulation,
 *      closing, talk ratio), each 0-100, plus an overall, 2-3 concrete tips,
 *      and a best/worst moment quoted from the transcript. Output is strict
 *      JSON, parsed defensively in scoring.ts.
 *
 * Everything here is sales-native — Axil is a sales prospect / sales coach, with
 * no real-estate framing. The builders are exported and unit-tested so the
 * contract (objections present, JSON schema described) is pinned.
 */

import type { Icp, IcpPersona } from './icp';
import type { Transcript } from './session';

// ── Shared persona rendering ─────────────────────────────────────────────────

function renderList(label: string, items: string[]): string | null {
  const clean = items.map((i) => i.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return `${label}:\n${clean.map((i) => `  - ${i}`).join('\n')}`;
}

function renderField(label: string, value: string): string | null {
  const v = value.trim();
  return v ? `${label}: ${v}` : null;
}

/**
 * Render an ICP persona as a compact, labeled block both prompts share. Empty
 * fields are dropped so a thin persona produces a clean prompt rather than a
 * wall of blank labels.
 */
export function renderPersona(persona: IcpPersona): string {
  return [
    renderField('Industry', persona.industry),
    renderField('Company size', persona.company_size),
    renderField('Role / title', persona.role),
    renderField('Budget', persona.budget_band),
    renderField('Buying process', persona.buying_process),
    renderField('Temperament', persona.temperament),
    renderList('Pain points', persona.pain_points),
    renderList('Objections they will raise', persona.objections),
  ]
    .filter(Boolean)
    .join('\n');
}

// ── 1. Prospect roleplay system prompt ───────────────────────────────────────

/**
 * Build the system prompt that makes Axil roleplay a prospect drawn from `icp`.
 * The optional `scenario` is a rep-supplied setup ("you're 5 minutes into a
 * cold call", "you requested a demo after reading a case study") that colors
 * the prospect's starting posture.
 */
export function buildProspectSystemPrompt(icp: Icp, scenario?: string | null): string {
  const personaBlock = renderPersona(icp.persona);
  const scenarioLine = scenario && scenario.trim() ? scenario.trim() : null;

  const lines: string[] = [
    "You are role-playing a sales PROSPECT so a sales rep can practice a live call. You are NOT an assistant and you are NOT the seller — you are the buyer the rep is trying to win.",
    '',
    `You are: ${icp.name}.`,
  ];

  if (icp.description && icp.description.trim()) {
    lines.push(icp.description.trim());
  }

  if (personaBlock) {
    lines.push('', 'Your profile:', personaBlock);
  }

  if (scenarioLine) {
    lines.push('', `Scenario / how this call started: ${scenarioLine}`);
  }

  lines.push(
    '',
    'How to play it:',
    '- Stay fully in character as this prospect. Never break character, never reveal you are an AI, never narrate or coach the rep mid-call.',
    '- Talk like a real person on a sales call: 1-3 sentences per reply, conversational, no bullet points or essays.',
    '- Let your temperament drive your tone. A skeptical, time-poor buyer is short and a little guarded; a collaborative one is warmer but still wants proof.',
    "- Raise the objections listed in your profile when they naturally fit — push back, ask hard questions, don't fold the moment the rep pitches.",
    "- Make the rep earn it. Don't volunteer everything; reward good discovery questions with real answers, and stay vague when they pitch without understanding your situation.",
    '- You can warm up, agree to a next step, or even say no — react to how well the rep actually sells, not on a script. If they nail it, let it move forward.',
    '- Keep it to ONE prospect speaking turn per reply. Do not write the rep\'s lines.',
    '',
    'Respond only as the prospect would speak out loud.',
  );

  return lines.join('\n');
}

// ── 2. Scoring prompt ────────────────────────────────────────────────────────

/** The five rubric dimensions, in display order. Shared with scoring.ts so the
 *  parser and the prompt never drift. */
export const RUBRIC_DIMENSIONS = [
  'discovery',
  'objection_handling',
  'value_articulation',
  'closing',
  'talk_ratio',
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

/** One-line definitions the model scores against — kept terse and concrete. */
const RUBRIC_GUIDE: Record<RubricDimension, string> = {
  discovery:
    'discovery — did the rep ask open questions and uncover the prospect\'s real pains, priorities, and buying process before pitching?',
  objection_handling:
    'objection_handling — did the rep acknowledge objections, stay calm, and respond with substance instead of dodging or getting defensive?',
  value_articulation:
    'value_articulation — did the rep tie the product to THIS prospect\'s pains and quantify outcomes, rather than listing generic features?',
  closing:
    'closing — did the rep drive toward a concrete next step (trial, pilot, follow-up, decision) and ask for it clearly?',
  talk_ratio:
    'talk_ratio — did the rep let the prospect talk? Reward listening and good questions; penalize monologues. 100 = ideal balance, low = the rep dominated or barely engaged.',
};

/**
 * Render a transcript as a plain "Rep:" / "Prospect:" script for the grader.
 * Roles are normalized to the two the rubric understands.
 */
export function renderTranscript(transcript: Transcript): string {
  if (!transcript || transcript.length === 0) return '(no turns were exchanged)';
  return transcript
    .map((t) => {
      const who = t.role === 'rep' ? 'Rep' : 'Prospect';
      return `${who}: ${t.content}`;
    })
    .join('\n');
}

/**
 * Build the system prompt for the post-call grader. Describes the rubric and
 * pins the exact JSON shape scoring.ts parses. Strict instruction to return
 * ONLY JSON — the parser is still defensive, but this keeps it cheap.
 */
export function buildScoringSystemPrompt(): string {
  const rubricBlock = RUBRIC_DIMENSIONS.map((d) => `  - ${RUBRIC_GUIDE[d]}`).join('\n');

  return [
    'You are Axil, a sharp but supportive sales coach. You just observed a mock sales call where a rep practiced against a role-played prospect. Grade the REP — not the prospect — and give coaching that makes them better on the next real call.',
    '',
    'Score each rubric dimension from 0 to 100, where 0 is "did not do this at all" and 100 is "textbook":',
    rubricBlock,
    '',
    'Then:',
    '- overall: a 0-100 number — your holistic read of the rep, not a strict average.',
    '- tips: 2-3 concrete, specific coaching tips. Reference what actually happened in the call. Each tip is one sentence, actionable, no fluff.',
    '- best_moment: a short verbatim (or near-verbatim) quote of the rep\'s strongest line, with one clause on why it worked.',
    '- worst_moment: a short verbatim quote of the rep\'s weakest line or biggest missed opportunity, with one clause on what to do instead.',
    '',
    'Be honest and calibrated: a rep who barely engaged or never asked for the deal should score low. A short transcript can still be graded on what little happened.',
    '',
    'Respond with ONLY a JSON object, no prose, no code fences, in exactly this shape:',
    '{',
    '  "rubric": {',
    '    "discovery": <0-100>,',
    '    "objection_handling": <0-100>,',
    '    "value_articulation": <0-100>,',
    '    "closing": <0-100>,',
    '    "talk_ratio": <0-100>',
    '  },',
    '  "overall": <0-100>,',
    '  "tips": ["<tip>", "<tip>"],',
    '  "best_moment": "<quote — why it worked>",',
    '  "worst_moment": "<quote — what to do instead>"',
    '}',
  ].join('\n');
}

/**
 * Build the user message for the grader: the ICP being practiced against plus
 * the full transcript. Pairs with `buildScoringSystemPrompt`.
 */
export function buildScoringUserPrompt(icp: Icp, transcript: Transcript): string {
  const personaBlock = renderPersona(icp.persona);
  return [
    `The rep practiced selling to this prospect profile (${icp.name}):`,
    personaBlock || '(no persona details)',
    '',
    'Transcript of the mock call:',
    renderTranscript(transcript),
    '',
    'Grade the rep now.',
  ].join('\n');
}
