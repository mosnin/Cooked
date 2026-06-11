/**
 * The composer — turns a list of Signals from all sources into one Brief.
 *
 * Single responsibility: ranking and selecting. Source-agnostic. Adding a
 * new integration is "add a new SignalGatherer to the sources array."
 * The composer doesn't change.
 *
 * The right to say nothing is the central rule. When fewer than one signal
 * beats the confidence floor, the composer returns a Brief with empty
 * cards and an `emptyState` invitation — *never* a brief padded with
 * filler that teaches the realtor to ignore tomorrow's edition.
 */

import {
  CONFIDENCE_FLOOR,
  MAX_CARDS,
  type Brief,
  type BriefCard,
  type BriefCardMeta,
  type Signal,
  type SignalGatherer,
  type SignalKind,
  type SignalSource,
} from './types';

import { pipelineSource } from './signal-sources/pipeline';
import { leadsSource } from './signal-sources/leads';
import { calendarSource } from './signal-sources/calendar';
import { draftsSource } from './signal-sources/drafts';
import { calendarGoogleSource } from './signal-sources/calendar-google';
import { gmailSource } from './signal-sources/gmail';
import { hubspotSource } from './signal-sources/hubspot';
import { slackSource } from './signal-sources/slack';
import { composeMomentum } from './momentum';
import { composeTomorrow } from './tomorrow';
import { pickBestTip, tipToCard } from './tips/tips-source';

/**
 * The active source list. Phase A shipped three internal Chippi-DB
 * sources. Phase B layers more on — `drafts` surfaces the autonomous
 * agent's pending AgentDraft rows; `calendar_google` (Phase D2) pulls
 * external Calendar; `gmail` (Phase D3) catches quiet sent threads and
 * inbound the agent skipped; `hubspot` (Phase D1) surfaces cross-CRM
 * drift; `slack` (Phase D4) catches @-mentions + teammate DMs. The
 * composer needs no change as the list grows.
 */
const SOURCES: SignalGatherer[] = [
  pipelineSource,
  leadsSource,
  calendarSource,
  draftsSource,
  calendarGoogleSource,
  gmailSource,
  hubspotSource,
  slackSource,
];

/**
 * Rank rule: ascending urgency (1 = today, 3 = soon), then descending
 * confidence as the tiebreak. Signals at or below the floor are dropped
 * before this runs — only competitors enter the sort.
 */
function rankSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency - b.urgency;
    return b.confidence - a.confidence;
  });
}

/**
 * Pick the top N, deduplicating by subject.id. A single contact / deal
 * can produce signals from multiple sources (Gmail thread + overdue
 * follow-up from leads source for the same person); the realtor sees
 * one card per subject, leading with the highest-ranked angle.
 *
 * Returns BOTH the surface-facing cards AND the server-only meta
 * (confidence + urgency). The two arrays mirror each other by index.
 */
function selectCards(ranked: Signal[]): { cards: BriefCard[]; meta: BriefCardMeta[] } {
  const seen = new Set<string>();
  const cards: BriefCard[] = [];
  const meta: BriefCardMeta[] = [];

  for (const signal of ranked) {
    if (cards.length >= MAX_CARDS) break;
    if (seen.has(signal.subject.id)) continue;
    seen.add(signal.subject.id);
    const idx = cards.length;
    cards.push({
      kind: signal.kind,
      source: signal.source,
      subject: signal.subject,
      evidence: signal.evidence,
      draftedAction: signal.draftedAction ?? null,
    });
    meta.push({
      cardIndex: idx,
      source: signal.source,
      kind: signal.kind,
      confidence: signal.confidence,
      urgency: signal.urgency,
    });
  }

  return { cards, meta };
}

/**
 * The headline — one sentence, the loudest signal named explicitly.
 * Falls back to a calm neutral when there's just one card with no
 * specific subject pull.
 *
 * The brand voice rule: name a specific subject. "The Chen deal hasn't
 * moved in fourteen days." Not "1 deal is stuck."
 */
function composeHeadline(cards: BriefCard[]): { headline: string; subheadline: string | null } {
  if (cards.length === 0) return { headline: '', subheadline: null };

  const lead = cards[0];
  const headline = headlineForCard(lead);
  const others = cards.length - 1;
  const subheadline =
    others > 0
      ? `${others} other thing${others === 1 ? '' : 's'} need${others === 1 ? 's' : ''} you.`
      : null;

  return { headline, subheadline };
}

function headlineForCard(card: BriefCard): string {
  const { kind, subject, evidence } = card;
  switch (kind) {
    case 'review':
      // Pipeline review — usually a stuck deal.
      return `${subject.name}: ${evidence.toLowerCase()}.`;
    case 'prep':
      // Upcoming tour — "Reynolds tour at 10:00 AM."
      return `${subject.name} — ${evidence}.`;
    case 'call':
      return `Call ${subject.name}. ${evidence}`;
    case 'reply':
      return `Reach ${subject.name}. ${evidence}`;
    case 'sign':
      return `${subject.name} is awaiting signature.`;
    case 'celebrate':
      return `${subject.name}. ${evidence}`;
    default:
      return `${subject.name}. ${evidence}`;
  }
}

/**
 * What Chippi says when the realtor has nothing on fire. The right to
 * say nothing is the central design rule; this is its prose.
 */
function composeEmptyState(): { invitation: string } {
  return {
    invitation: 'Quiet morning. Nothing chasing you. Want me to start prospecting?',
  };
}

/**
 * The main entry. Reads from all signal sources for the given space,
 * ranks, selects, composes, returns one Brief + the server-only cardMeta
 * for telemetry (Phase B5).
 *
 * The Brief itself is unchanged — surface contract is stable. The meta
 * is persisted to Brief.cardMeta separately by the caller so it never
 * leaks to the surface.
 */
export async function composeBrief(
  spaceId: string,
): Promise<{ brief: Brief; cardMeta: BriefCardMeta[] }> {
  // Sources, momentum, tomorrow, and the tips engine all hit Supabase
  // independently — fan them out in parallel so the cron's per-space
  // budget stays tight.
  const [sourceResults, momentum, tomorrow, bestTip] = await Promise.all([
    Promise.allSettled(SOURCES.map((s) => s.gather(spaceId))),
    composeMomentum(spaceId).catch(() => null),
    composeTomorrow(spaceId).catch(() => null),
    pickBestTip(spaceId).catch(() => null),
  ]);

  const allSignals: Signal[] = [];
  const sourcesUsed = new Set<SignalSource>();

  for (let i = 0; i < sourceResults.length; i++) {
    const result = sourceResults[i];
    const source = SOURCES[i].source;
    if (result.status !== 'fulfilled') continue;
    if (result.value.length > 0) sourcesUsed.add(source);
    for (const signal of result.value) {
      if (signal.confidence > CONFIDENCE_FLOOR) allSignals.push(signal);
    }
  }

  const ranked = rankSignals(allSignals);
  const { cards, meta } = selectCards(ranked);

  // Tip slot rules (Phase C):
  //   - When cards is empty AND tip exists, the tip's prose REPLACES the
  //     empty-state invitation (the headline becomes the tip's subject,
  //     subheadline becomes the evidence).
  //   - When cards exist AND the tip confidence is ≥ 0.85 AND the tip's
  //     subject isn't already in cards, the tip renders as Brief.tip
  //     (one extra card below the regular cards).
  //   - Otherwise tip is null.
  const tipQualifiesForBottom =
    bestTip != null &&
    bestTip.confidence >= 0.85 &&
    !cards.some((c) => c.subject.id === bestTip.subject.id);

  if (cards.length === 0 && bestTip) {
    sourcesUsed.add('tips');
    return {
      brief: {
        headline: bestTip.subject.name,
        subheadline: bestTip.evidence,
        cards: [],
        tip: tipToCard(bestTip),
        momentum,
        tomorrow,
        // The tip replaces the emptyState — calmer than rendering both.
        emptyState: null,
        sourcesUsed: [...sourcesUsed],
      },
      cardMeta: [],
    };
  }

  if (cards.length === 0) {
    return {
      brief: {
        headline: 'Quiet morning.',
        subheadline: null,
        cards: [],
        tip: null,
        momentum,
        tomorrow,
        emptyState: composeEmptyState(),
        sourcesUsed: [...sourcesUsed],
      },
      cardMeta: [],
    };
  }

  const { headline, subheadline } = composeHeadline(cards);

  if (tipQualifiesForBottom && bestTip) sourcesUsed.add('tips');

  return {
    brief: {
      headline,
      subheadline,
      cards,
      tip: tipQualifiesForBottom && bestTip ? tipToCard(bestTip) : null,
      momentum,
      tomorrow,
      emptyState: null,
      sourcesUsed: [...sourcesUsed],
    },
    cardMeta: meta,
  };
}

// ── Exports for testing — the composer is the one piece worth locking ──

export const __internals = {
  rankSignals,
  selectCards,
  composeHeadline,
};
