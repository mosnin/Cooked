/**
 * Agent authorship badges — the "this came from Koala" cue stamped
 * on AgentDraft rows, conversation messages, activity rows, etc.
 *
 * Two primitives:
 *   - `AgentGeneratedBadge` — inline pill with the Koala mark and
 *     wordmark. Phase 2 upgrade: bigger, tactile, opt-in trigger
 *     source hover.
 *   - `AgentGeneratedBorder` — left-border treatment that says "the
 *     whole block below is Koala's work."
 *
 * Both reach for `BRAND_ORANGE_CONTEXTS.AGENT_BADGE` via the
 * `brandOrange()` wrapper so the stray-orange lint rule (Phase 2)
 * can verify the usage is deliberate.
 */

import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { brandOrange } from '@/lib/colors';

/**
 * `AgentGeneratedBadge` — Koala's authorship pill.
 *
 * Phase 2 upgrade: was a 3px pill that barely existed. Now a 12px
 * chip — readable without leaning in, still under-emphatic compared
 * to the row's primary content.
 *
 * Optional `triggerSource` prop surfaces the provenance breadcrumb
 * on hover via the `title` attribute (tooltip on desktop, ignored on
 * touch — that's fine; the breadcrumb also lives inline in the row
 * body where touch users will see it). When absent the badge just
 * says "Koala."
 *
 * Tip: pair with `aria-label` on the surrounding row so screen
 * readers say "Authored by Koala, [row content]" not just "Koala."
 */
export function AgentGeneratedBadge({
  className,
  triggerSource,
}: {
  className?: string;
  /** Optional one-liner like "Noticed a Gmail reply" — surfaces on hover. */
  triggerSource?: string;
}) {
  return (
    <span
      title={triggerSource ?? 'Authored by Koala'}
      className={brandOrange(
        'AGENT_BADGE',
        cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
          'text-[10px] font-medium leading-none',
          'text-orange-600 dark:text-orange-400',
          'bg-orange-500/[0.08] dark:bg-orange-500/[0.12]',
          className,
        ),
      )}
    >
      <Bot size={10} strokeWidth={2.25} />
      Koala
    </span>
  );
}

/**
 * `AgentGeneratedBorder` — left-edge treatment that scopes a block
 * of content to "this was Koala's work."
 *
 * Used to wrap whole draft rows, agent-suggested cards, and the
 * morning replay narrative. The border is 2px not 1px because it's
 * carrying meaning, not structure — same logic as the sidebar's
 * active-rail.
 */
export function AgentGeneratedBorder({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={brandOrange(
        'AGENT_BADGE',
        cn(
          'border-l-2 border-orange-400 dark:border-orange-500/60 pl-3',
          className,
        ),
      )}
    >
      {children}
    </div>
  );
}
