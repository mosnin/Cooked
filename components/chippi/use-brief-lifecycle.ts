'use client';

/**
 * The brief is a moment, not a surface. It exists to wake the realtor
 * up, hand them five things, then disappear. Three states:
 *
 *   live     — pending OR (seen AND less than DWELL_MS since seenAt)
 *              Full brief is the focal element. Composer waits.
 *
 *   settled  — acted, OR (seen AND DWELL_MS+ since seenAt)
 *              Collapses to a one-line receipt above the greeting.
 *              Composer is focal.
 *
 *   carried  — same-day return visit. Renders identically to settled —
 *              the difference is only diagnostic. Useful for analytics.
 *
 * The 60-second dwell is the lifecycle agent's call: short enough that a
 * 9am return doesn't show the full brief again, long enough that the
 * realtor doesn't lose the brief mid-read by accident.
 */

import { useEffect, useState } from 'react';

export type BriefLifecycleState = 'live' | 'settled' | 'carried';

export const DWELL_MS = 60_000;

interface UseBriefLifecycleArgs {
  status: 'pending' | 'seen' | 'acted' | 'failed';
  seenAt: string | null;
  /** Manual collapse override — `Open` button on collapsed surface
   *  flips this true; auto-collapse timer flips it false. */
  forceExpanded: boolean;
  /** Manual collapse override — set true when the realtor explicitly
   *  collapses (no UI today; future-proofed for a Dismiss affordance). */
  forceCollapsed: boolean;
}

export function useBriefLifecycle({
  status,
  seenAt,
  forceExpanded,
  forceCollapsed,
}: UseBriefLifecycleArgs): BriefLifecycleState {
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second only while we might transition. Once settled we
  // stop ticking entirely — no point burning the CPU after the state
  // can't change again until the user does something.
  useEffect(() => {
    if (status === 'acted' || forceCollapsed) return;
    if (status === 'seen' && seenAt) {
      const elapsed = Date.now() - new Date(seenAt).getTime();
      if (elapsed >= DWELL_MS) return;
    }
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [status, seenAt, forceCollapsed]);

  if (forceCollapsed) return 'settled';
  if (forceExpanded) return 'live';
  if (status === 'acted') return 'settled';
  if (status === 'pending') return 'live';
  if (status === 'seen' && seenAt) {
    const elapsed = now - new Date(seenAt).getTime();
    return elapsed >= DWELL_MS ? 'settled' : 'live';
  }
  return 'live';
}

/**
 * Format the "3 of 5 done" receipt. Counts tapped cards from the
 * lifecycle PATCHes (or 0 if telemetry hasn't shipped yet — Phase B5
 * will provide a real count, today we approximate from `acted` boolean).
 */
export function formatProgress(
  totalCards: number,
  actedAt: string | null,
): string {
  if (totalCards === 0) return 'Nothing today';
  // The receipt has to sound like a realtor would talk about their
  // own morning — "handled," not "acted on" (that's product-internal).
  // Pre-B5: we know handled-or-not but not which/how-many cards. The
  // honest summary is "handled" or just the count.
  // Post-B5: replace with actual tap-count from cardTaps[].length.
  if (actedAt) return `${totalCards} ${totalCards === 1 ? 'card' : 'cards'} · handled`;
  return `${totalCards} ${totalCards === 1 ? 'card' : 'cards'}`;
}

/** Format "last opened 7:11a" in short local time. */
export function formatLastOpened(seenAt: string | null): string | null {
  if (!seenAt) return null;
  const date = new Date(seenAt);
  if (isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  // "7:11 AM" → "7:11a" — fits the collapsed receipt's tight line.
  return time.replace(/\s?AM/i, 'a').replace(/\s?PM/i, 'p');
}
