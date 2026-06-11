/**
 * Five named moments where brand orange earns its place. Each
 * primitive imports a context tag from `lib/colors.ts` so the
 * stray-orange lint rule (Phase 2) can verify the orange is
 * deliberate.
 *
 * Read STYLESHEET.md §Color §The brand orange rule before adding a
 * sixth — adding requires deleting one of the existing five.
 */

import { cn } from '@/lib/utils';
import { brandOrange } from '@/lib/colors';

/**
 * `ChippiAuthoredDot` — a 4px orange dot rendered beside the
 * author's icon on rows where Chippi was the actor.
 *
 * Used in: activity feed rows, conversation message metadata,
 * audit-log entries. ONLY on rows where `agentType === 'chippi'`.
 *
 * The dot is non-decorative — its presence reads as "this row was
 * Chippi's work, not the realtor's." Pair with `aria-label` for
 * screen readers.
 */
export function ChippiAuthoredDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="By Chippi"
      className={brandOrange(
        'AGENT_BADGE',
        cn(
          'inline-block w-1 h-1 rounded-full',
          'bg-orange-500 dark:bg-orange-400',
          className,
        ),
      )}
    />
  );
}

/**
 * `ChippiWordmarkInline` — the literal word "Chippi" rendered in
 * serif Times in `text-orange-600`, sized to flow inline with body
 * copy.
 *
 * Use it once per surface, at most. The whole point is scarcity:
 * when "Chippi" reads as the punctuation of a sentence, the brand
 * becomes the voice of the product.
 *
 * Reach for this in:
 *   - The morning-story headline when introducing what Chippi did
 *     overnight ("**Chippi** drafted 3 messages while you slept.")
 *   - The empty-state line on /chippi/today when no work happened
 *   - A post-action acknowledgment ("**Chippi** sent it.") sparingly
 *
 * Do NOT reach for it in:
 *   - Anything multi-occurrence (a list, a table, repeated UI)
 *   - Body paragraphs where the brand is mentioned by name multiple
 *     times — pick one, leave the rest as plain text
 */
export function ChippiWordmarkInline({ className }: { className?: string }) {
  return (
    <span
      className={brandOrange(
        'CHIPPI_AVATAR',
        cn(
          'text-orange-600 dark:text-orange-400',
          className,
        ),
      )}
      style={{ fontFamily: 'var(--font-title)' }}
    >
      Chippi
    </span>
  );
}
