'use client';

/**
 * Action pills under the contact-detail headline. Same shape and copy as
 * <MorningStory />` — tap a pill, the inline draft surface opens, the
 * rep reviews + sends without leaving the page.
 *
 * Before this file existed, the pills rendered as `<button>` with a
 * `data-intent` attribute and *no onClick handler* — every rep who
 * tapped "Welcome them" or "Reach out" got silence. The bug was honest:
 * the page advertised actions it didn't fire. This component wires them.
 *
 * Compose intents (`check-in`, `log-call`, `welcome`, `reach-out`) go
 * through the existing `<MorningActionSheet />` — same draft pipeline as
 * the morning home. `schedule-demo` is a navigate-style verb; the API
 * doesn't compose a demo message, so it drops the rep into the chat
 * with a prefill that names the contact and the intent.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DURATION_BASE, EASE_OUT } from '@/lib/motion';
import { MorningActionSheet } from '@/components/koala/morning-action-sheet';
import type { MorningActionIntent } from '@/components/koala/morning-actions';
import type {
  PeopleDetailAction,
  PeopleDetailActionIntent,
} from '@/lib/people-detail-actions';

interface Props {
  slug: string;
  contactId: string;
  contactName: string;
  actions: ReadonlyArray<PeopleDetailAction>;
}

const COMPOSE_INTENTS: ReadonlyArray<PeopleDetailActionIntent> = [
  'check-in',
  'log-call',
  'welcome',
  'reach-out',
];

function isComposeIntent(
  intent: PeopleDetailActionIntent,
): intent is MorningActionIntent {
  return (COMPOSE_INTENTS as ReadonlyArray<string>).includes(intent);
}

export function ContactActionPills({
  slug,
  contactId,
  contactName,
  actions,
}: Props) {
  const router = useRouter();
  // Which pill is currently expanded into a draft sheet. One open at a time;
  // tapping a different pill swaps the sheet contents.
  const [activeIntent, setActiveIntent] = useState<MorningActionIntent | null>(
    null,
  );

  function handleTap(action: PeopleDetailAction) {
    if (isComposeIntent(action.intent)) {
      setActiveIntent(action.intent);
      return;
    }
    if (action.intent === 'schedule-demo') {
      router.push(
        `/s/${slug}/koala?prefill=${encodeURIComponent(
          `Schedule a demo with ${contactName}.`,
        )}`,
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => handleTap(a)}
            className={cn(
              'inline-flex items-center h-9 rounded-md px-4 text-sm transition-colors',
              i === 0
                ? 'border border-border/70 bg-foreground text-background hover:bg-foreground/90'
                : 'border border-border/70 bg-background text-foreground hover:bg-muted/40',
              activeIntent === a.intent && 'ring-1 ring-foreground/30',
            )}
            data-intent={a.intent}
          >
            {a.label}
          </button>
        ))}
        {/* "Log a demo" stays a Link — the /koala/log surface is a short
            recording flow, not a draft. Outline-shape to read as a peer to
            the secondary pills. */}
        <Link
          href={`/s/${slug}/koala/log?personId=${contactId}`}
          className={cn(
            'inline-flex items-center gap-1.5 h-9 rounded-md px-4 text-sm transition-colors',
            'border border-border/70 bg-background text-foreground hover:bg-muted/40',
          )}
        >
          <Mic size={13} />
          Log a demo
        </Link>
      </div>

      <AnimatePresence initial={false}>
        {activeIntent && (
          <motion.div
            key={activeIntent}
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: { duration: DURATION_BASE, ease: EASE_OUT },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { duration: DURATION_BASE, ease: EASE_OUT },
            }}
            className="overflow-hidden"
          >
            <MorningActionSheet
              slug={slug}
              intent={activeIntent}
              context={{
                kind: 'person',
                id: contactId,
                label: contactName,
              }}
              onSent={() => setActiveIntent(null)}
              onCancel={() => setActiveIntent(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
