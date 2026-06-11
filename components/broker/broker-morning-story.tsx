'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { DURATION_BASE, EASE_OUT } from '@/lib/motion';
import { formatCompact } from '@/lib/formatting';
import type { BrokerMorningResponse } from '@/app/api/broker/morning/route';

/**
 * The /broker home's chief-of-staff opening line.
 *
 * Replaces the old snapshot-counts pattern ("5 realtors, 2 drafts, 3 hot
 * leads") with ONE prioritized action the broker should take RIGHT NOW —
 * composed server-side by /api/broker/morning. The single sentence is the
 * focal element on the page; the small hairline stats row below it is
 * context, not the headline.
 *
 * When the API returns a non-null `suggestedPrompt`, tapping the headline
 * deep-links into /broker/chippi with the prompt prefilled — making the
 * agent's affordance ("want me to ...") into a single-tap doorway. When
 * `suggestedPrompt` is null (milestone, fallback), the headline renders
 * non-interactive.
 */

const STATS_LOADING: BrokerMorningResponse['stats'] = {
  realtors: 0,
  activeDeals: 0,
  gciMtd: 0,
};

/**
 * Split the headline at the first em-dash so the call-to-action clause
 * gets slightly stronger weight. The pattern is "<fact> — <action>." or
 * "<fact> — <fact>." — either way the second clause is the one the
 * broker's eye should land on. Falls back to rendering the whole headline
 * at one weight when there's no em-dash (the fallback sentence has none).
 */
function splitHeadline(text: string): { lead: string; action: string | null } {
  const idx = text.indexOf(' — ');
  if (idx === -1) return { lead: text, action: null };
  return {
    lead: text.slice(0, idx),
    action: text.slice(idx + 3),
  };
}

export function BrokerMorningStory() {
  const router = useRouter();
  const [data, setData] = useState<BrokerMorningResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/broker/morning', { signal: controller.signal });
        if (res.ok) {
          const body = (await res.json()) as BrokerMorningResponse;
          setData(body);
        } else {
          setError(true);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(true);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  // While loading, hold the layout with a non-breaking space so the page
  // doesn't jump when the sentence arrives.
  if (!data && !error) {
    return (
      <div className="space-y-4">
        <h1
          className="text-[2.25rem] sm:text-[2.5rem] tracking-tight text-foreground leading-tight"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          &nbsp;
        </h1>
        <StatsRow stats={STATS_LOADING} loading />
      </div>
    );
  }

  // On a hard error we still anchor the page with the fallback line — never
  // show marketing copy, never leave the H1 blank.
  const headline = data?.headline ?? "Quiet morning. Team's healthy.";
  const suggestedPrompt = data?.suggestedPrompt ?? null;
  const stats = data?.stats ?? STATS_LOADING;
  const { lead, action } = splitHeadline(headline);
  const isInteractive = Boolean(suggestedPrompt);

  function handleTap() {
    if (!suggestedPrompt) return;
    router.push(
      `/broker/chippi?prefill=${encodeURIComponent(suggestedPrompt)}`,
    );
  }

  const headlineNode = (
    <span className="block">
      <span className="text-foreground/90">{lead}</span>
      {action && (
        <>
          <span className="text-foreground/90"> — </span>
          <span className="text-foreground font-medium">{action}</span>
        </>
      )}
    </span>
  );

  return (
    <div className="space-y-4">
      {isInteractive ? (
        <motion.button
          type="button"
          onClick={handleTap}
          key={headline}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
          className={cn(
            'text-[2.25rem] sm:text-[2.5rem] tracking-tight leading-tight block text-left',
            'text-foreground hover:opacity-80 transition-opacity cursor-pointer',
          )}
          style={{ fontFamily: 'var(--font-title)' }}
        >
          {headlineNode}
        </motion.button>
      ) : (
        <motion.h1
          key={headline}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
          className="text-[2.25rem] sm:text-[2.5rem] tracking-tight leading-tight text-foreground"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          {headlineNode}
        </motion.h1>
      )}
      <StatsRow stats={stats} loading={!data} />
    </div>
  );
}

/**
 * Hairline-divider context row. Three numbers — realtors, active deals,
 * GCI MTD — rendered as small, muted facts beneath the headline. This is
 * intentionally NOT the snapshot strip from app/broker/page.tsx (that's
 * the heavier card grid further down the page); this is the quiet beat
 * between the focal sentence and the rest of the dashboard.
 */
function StatsRow({
  stats,
  loading,
}: {
  stats: BrokerMorningResponse['stats'];
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 text-[11px] tabular-nums text-muted-foreground">
      <Stat label="realtors" value={loading ? '—' : `${stats.realtors}`} />
      <Divider />
      <Stat label="active deals" value={loading ? '—' : `${stats.activeDeals}`} />
      <Divider />
      <Stat
        label="GCI MTD"
        value={loading ? '—' : formatCompact(stats.gciMtd)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-foreground/80">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Divider() {
  return <span aria-hidden className="h-3 w-px bg-border/70" />;
}
