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
 * `KoalaAuthoredDot` — a 4px orange dot rendered beside the
 * author's icon on rows where Koala was the actor.
 *
 * Used in: activity feed rows, conversation message metadata,
 * audit-log entries. ONLY on rows where `agentType === 'koala'`.
 *
 * The dot is non-decorative — its presence reads as "this row was
 * Koala's work, not the rep's." Pair with `aria-label` for
 * screen readers.
 */
export function KoalaAuthoredDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="By Koala"
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
 * `KoalaWordmarkInline` — the literal word "Koala" rendered in
 * serif Times in `text-orange-600`, sized to flow inline with body
 * copy.
 *
 * Use it once per surface, at most. The whole point is scarcity:
 * when "Koala" reads as the punctuation of a sentence, the brand
 * becomes the voice of the product.
 *
 * Reach for this in:
 *   - The morning-story headline when introducing what Koala did
 *     overnight ("**Koala** drafted 3 messages while you slept.")
 *   - The empty-state line on /koala/today when no work happened
 *   - A post-action acknowledgment ("**Koala** sent it.") sparingly
 *
 * Do NOT reach for it in:
 *   - Anything multi-occurrence (a list, a table, repeated UI)
 *   - Body paragraphs where the brand is mentioned by name multiple
 *     times — pick one, leave the rest as plain text
 */
export function KoalaWordmarkInline({ className }: { className?: string }) {
  return (
    <span
      className={brandOrange(
        'KOALA_AVATAR',
        cn(
          'text-orange-600 dark:text-orange-400',
          className,
        ),
      )}
      style={{ fontFamily: 'var(--font-title)' }}
    >
      Koala
    </span>
  );
}
