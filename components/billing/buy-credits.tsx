'use client';

import { useState } from 'react';
import { TOPUPS, type TopupId } from '@/lib/plans';

/**
 * Buy-more-credits — the three top-up packs. Clicking one opens Stripe Checkout
 * (one-time payment); on success the webhook grants the credits. Paper-flat per
 * STYLESHEET: hairline-divider grid, rounded-xl, serif stat number, foreground
 * pill CTA, no shadow.
 */
export function BuyCredits({ slug }: { slug: string }) {
  const [loading, setLoading] = useState<TopupId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(topup: TopupId) {
    setLoading(topup);
    setError(null);
    try {
      const res = await fetch('/api/billing/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, topup }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not start checkout.');
        setLoading(null);
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError('Could not start checkout.');
      setLoading(null);
    }
  }

  const packs = Object.values(TOPUPS);

  return (
    <div className="space-y-3">
      <section className="grid gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60 sm:grid-cols-3">
        {packs.map((p) => (
          <div key={p.id} className="bg-background px-4 py-4 flex flex-col gap-1.5">
            <p className="text-sm font-medium text-foreground">{p.label}</p>
            <p
              className="text-[25px] tabular-nums tracking-tight text-foreground leading-none"
              style={{ fontFamily: 'var(--font-title)' }}
            >
              {p.credits.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">credits · ${p.price} one-time</p>
            <button
              type="button"
              onClick={() => buy(p.id as TopupId)}
              disabled={loading !== null}
              className="mt-2 inline-flex items-center justify-center rounded-full h-9 px-4 bg-foreground text-background text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
            >
              {loading === p.id ? 'Starting…' : 'Buy'}
            </button>
          </div>
        ))}
      </section>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Credits are added instantly and roll over for 30 days.
      </p>
    </div>
  );
}
