'use client';

/**
 * Subscribe — the commit moment, in the onboarding's voice.
 *
 * This is the same calm, paper-flat, Chippi-speaks aesthetic as the
 * conversational onboarding: the brand-warm wash, a serif line in Chippi's
 * first person, a hairline panel (no shadow, no animated border, no decorative
 * orange), and a soft fade-in arrival. By the time a realtor reaches here
 * they've met Chippi; this should feel like the next sentence, not a pivot to
 * a loud SaaS pricing page.
 *
 * The billing logic is UNCHANGED — auth gate, slug resolution, and the
 * /api/billing/checkout call are byte-for-byte what shipped before. Only the
 * surface changed.
 */

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { motion } from 'motion/react';
import { Check, Loader2 } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { brandOrange } from '@/lib/colors';
import { TITLE_FONT } from '@/lib/typography';

const FEATURES = [
  'I draft every follow-up. You approve.',
  'AI lead scoring on every applicant.',
  'Intake links that qualify leads for you.',
  'Tours scheduled and booked.',
  'Unlimited contacts and deals.',
  'Notes, calendar, and analytics.',
  'Connect Gmail, Slack, and more.',
  'MCP access for Claude and Cursor.',
];

function SubscribeContent() {
  const { isSignedIn, isLoaded } = useAuth();
  const searchParams = useSearchParams();
  const [slug, setSlug] = useState(searchParams.get('slug') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // If no slug in URL, fetch it from the user's space.
  useEffect(() => {
    if (slug || !isLoaded || !isSignedIn) return;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => { if (d.slug) setSlug(d.slug); })
      .catch(() => {});
  }, [slug, isLoaded, isSignedIn]);

  // Redirect unauthenticated users.
  if (isLoaded && !isSignedIn) {
    window.location.href = '/login/realtor';
    return null;
  }

  async function handleStartTrial() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.redirect) {
        window.location.href = data.redirect;
      } else {
        setError(data.error || 'Failed to start checkout');
        setLoading(false);
      }
    } catch {
      setError("That didn't go through. Usually temporary.");
      setLoading(false);
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-16 text-foreground">
      {/* Brand-warm wash — same as the onboarding surface, one of the five
          sanctioned orange contexts. */}
      <div
        aria-hidden
        className={brandOrange(
          'LOGO',
          'pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-orange-50/70 via-background to-orange-50/50 dark:from-orange-500/[0.04] dark:via-background dark:to-orange-500/[0.03]',
        )}
      />

      <motion.div
        className="relative z-10 w-full max-w-md"
        initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-8 flex justify-center">
          <BrandLogo className="h-6 opacity-90" alt="Chippi" />
        </div>

        {/* Chippi speaks — the focal element. */}
        <header className="space-y-2 text-center">
          <p className="text-sm text-muted-foreground">Chippi Solo.</p>
          <h1 className="text-3xl leading-tight tracking-tight sm:text-[2.5rem]" style={TITLE_FONT}>
            Let&apos;s keep working together.
          </h1>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            Everything you set up stays exactly as it is. Start your free trial and I&apos;ll keep going.
          </p>
        </header>

        {/* Paper-flat panel — hairline border, no shadow. */}
        <div className="mt-8 rounded-xl border border-border/70 bg-card p-6 sm:p-7">
          {/* Price */}
          <div className="flex items-end justify-center gap-1.5">
            <span className="text-[2.75rem] leading-none tabular-nums tracking-tight" style={TITLE_FONT}>
              $97
            </span>
            <span className="mb-1 text-base text-muted-foreground">/mo</span>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            7 days free, then $97 a month. Cancel anytime.
          </p>

          {/* Features */}
          <ul className="mt-6 space-y-3 border-t border-border/60 pt-6">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm leading-snug text-foreground">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06]">
                  <Check size={11} className="text-foreground/70" />
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {error && (
            <p className="mt-5 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </p>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={handleStartTrial}
            disabled={loading || !slug}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? 'Taking you to checkout.' : 'Start your 7 days free'}
          </button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Card required to start — you won&apos;t be charged until your trial ends. Cancel anytime.
          </p>
        </div>

        {/* Plans + already subscribed */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Need more?{' '}
          <a href="/pricing" className="text-foreground underline-offset-2 hover:underline">
            See all plans
          </a>
          {' · '}
          Already subscribed?{' '}
          <a
            href={slug ? `/s/${slug}/billing` : '#'}
            className="text-foreground underline-offset-2 hover:underline"
          >
            Manage billing
          </a>
        </p>
      </motion.div>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SubscribeContent />
    </Suspense>
  );
}
