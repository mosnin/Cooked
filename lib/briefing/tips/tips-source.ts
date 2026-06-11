/**
 * Tips source — runs every category, filters by cool-down, picks at
 * most one to surface in today's brief.
 *
 * Not a regular SignalGatherer because the output isn't "more cards
 * for the ranker." It's "the one tip that wins today's slot." The
 * composer calls this separately and assigns the result to Brief.tip.
 *
 * Selection rule (per the tips design):
 *   1. Named subject beats anonymous trend (single-subject > overdue_pileup, etc.)
 *   2. Magnitude — within named subjects, prefer higher confidence
 *   3. Recency — within ties, prefer the tip whose trigger is newest
 *      (proxied by confidence since we don't track trigger-onset dates)
 *   4. Cool-down filter applied before ranking
 *
 * The empty-state vs. bottom-of-brief decision is the COMPOSER's, not
 * this module's. This module just answers "what's the best earned tip
 * for this realtor right now, or null?"
 */

import { canFireTip, recordTipFired } from './cool-down';
import { ALL_TIP_CATEGORIES } from './tip-categories';
import type { Signal } from '../types';

/**
 * Whole-realtor trends — their subject string IS the category name (no
 * per-segment breakdown). Cool-down keys off (category, null) so the
 * trend fires at most once per cool-down window across the whole space.
 */
const ANONYMOUS_TREND_CATEGORIES = new Set([
  'overdue_pileup',
  'reply_rate_decline',
  'tour_conversion_drop',
]);

/**
 * Subject-prefix conventions for segment tips. A prefixed subject means
 * the tip is named to a real segment (a tag, a stage, a source) but
 * isn't a single contact/deal. These rank as "trends" for ordering but
 * keep the prefix as the cool-down subjectId so two segments cool down
 * independently.
 */
const SEGMENT_PREFIXES = ['tag:', 'stage:', 'source:'];

function isSegmentSubject(subjectId: string): boolean {
  return SEGMENT_PREFIXES.some((p) => subjectId.startsWith(p));
}

/**
 * Map a Signal to the cool-down key. Anonymous trends collapse to null;
 * everything else keeps its real subject id so the same person/deal/
 * segment cools down per-subject.
 */
function coolDownSubjectId(sig: Signal): string | null {
  if (!sig.tipCategory) return null;
  if (ANONYMOUS_TREND_CATEGORIES.has(sig.tipCategory)) return null;
  return sig.subject.id;
}

/**
 * For ranking, "named" means a real person or deal — anonymous trends
 * and segment buckets both lose to a tip with a real subject. Within
 * each bucket the tiebreaker is confidence desc.
 */
function isNamedSubject(sig: Signal): boolean {
  if (!sig.tipCategory) return true;
  if (ANONYMOUS_TREND_CATEGORIES.has(sig.tipCategory)) return false;
  return !isSegmentSubject(sig.subject.id);
}

export async function pickBestTip(spaceId: string): Promise<Signal | null> {
  // Run every category in parallel — each is one Supabase call (some are
  // a few). The brief's per-realtor budget is generous.
  const results = await Promise.allSettled(ALL_TIP_CATEGORIES.map((fn) => fn(spaceId)));

  const candidates: Signal[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const signal of result.value) candidates.push(signal);
    }
  }

  if (candidates.length === 0) return null;

  // Apply cool-down filter. Cheap — at most ~10 candidates × 1 query each.
  const eligible: Signal[] = [];
  for (const sig of candidates) {
    if (!sig.tipCategory) continue;
    const ok = await canFireTip(spaceId, sig.tipCategory, coolDownSubjectId(sig));
    if (ok) eligible.push(sig);
  }

  if (eligible.length === 0) return null;

  // Rank: named subjects > anonymous/segment, then confidence desc.
  eligible.sort((a, b) => {
    const aNamed = isNamedSubject(a);
    const bNamed = isNamedSubject(b);
    if (aNamed && !bNamed) return -1;
    if (!aNamed && bNamed) return 1;
    return b.confidence - a.confidence;
  });

  const winner = eligible[0];

  // Record the fire BEFORE returning so concurrent compose ticks (rare
  // but possible) don't both pick the same tip and double-stamp.
  if (winner.tipCategory) {
    await recordTipFired(spaceId, winner.tipCategory, coolDownSubjectId(winner));
  }

  return winner;
}

/**
 * Build the BriefCard shape for the surface from a tip Signal.
 * Tips render with a 'TIP' tag instead of the action verbs.
 */
export function tipToCard(signal: Signal): import('../types').BriefCard {
  return {
    kind: signal.kind,
    source: signal.source,
    subject: signal.subject,
    evidence: signal.evidence,
    draftedAction: signal.draftedAction ?? null,
  };
}
