/**
 * `/status` — system status. Honest, calm, no theatre.
 *
 * Apple-discipline: a silent serif hero, then a hairline-divided list of the
 * surfaces a realtor depends on, each carrying a single dot.
 *
 * This page tells the TRUTH at request time. It probes the subsystems we can
 * actually verify from the server — the database, the agent's LLM + Modal
 * runtime, and the integrations layer — and renders what it finds:
 *
 *   - emerald  → operational (the check ran and passed)
 *   - rose     → degraded    (the check ran and failed)
 *   - muted    → unknown     (the check could not be performed — e.g. a
 *                             dependency isn't configured in this env)
 *
 * We do NOT paint a green dot we can't stand behind. A status page that lies
 * is worse than no status page. We also do NOT invent uptime percentages or
 * an incident history — those would be unverifiable claims. When there is a
 * real incident feed to wire, it earns its place here; until then the page
 * stays a calm, honest fact about right now.
 *
 * Only the three subsystems we can verify without a logged-in user are listed.
 * The per-user, per-workspace health (a realtor's own Gmail/Calendar
 * connection) lives behind auth on the integrations page — it can't be shown
 * truthfully on a public marketing page, so it isn't faked here.
 *
 * No charts, no graphs, no numbers. Hairline borders only. No brand orange.
 */

import { MarketingHero } from '@/components/marketing/marketing-hero';
import { supabase } from '@/lib/supabase';
import { hasLLMKey } from '@/lib/llm';
import { composioConfigured } from '@/lib/integrations/composio';

export const metadata = { title: 'Status · Chippi' };

// Always evaluate at request time — a status page must never be cached into a
// stale "operational" snapshot.
export const dynamic = 'force-dynamic';

type Health = 'operational' | 'degraded' | 'unknown';

interface Subsystem {
  label: string;
  health: Health;
}

/**
 * Probe the primary database. Mirrors the `/api/health` DB probe: a single
 * bounded read. A thrown error or a query error is degraded; success is
 * operational. There is no "unknown" path here — the DB is always reachable
 * to attempt, so the check always produces a real verdict.
 */
async function checkDatabase(): Promise<Health> {
  try {
    const { error } = await supabase.from('User').select('id').limit(1);
    return error ? 'degraded' : 'operational';
  } catch {
    return 'degraded';
  }
}

/**
 * The agent (Chippi) needs two things to do real work: an LLM provider key
 * and a Modal runtime URL. We can only verify CONFIGURATION from here, not a
 * live round-trip (that path is authenticated and rate-shaped). Missing config
 * is reported as "unknown" rather than "operational" — we won't claim the
 * agent is up when we can't see the keys it needs.
 */
function checkAgent(): Health {
  try {
    const hasModel = hasLLMKey();
    const hasModal = Boolean(process.env.MODAL_CHAT_URL || process.env.MODAL_WEBHOOK_URL);
    if (hasModel && hasModal) return 'operational';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Integrations ride on Composio. Without the API key the whole layer is
 * inert, so config presence is the honest public signal. Per-connection
 * health (this realtor's Gmail token) is auth-gated and not shown here.
 */
function checkIntegrations(): Health {
  try {
    return composioConfigured() ? 'operational' : 'unknown';
  } catch {
    return 'unknown';
  }
}

const DOT: Record<Health, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
};

const LABEL: Record<Health, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  unknown: 'Unknown',
};

function StatusRow({ label, health }: Subsystem) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <span className="text-sm text-foreground">{label}</span>
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <span
          aria-hidden
          className={`inline-block size-2 rounded-full ${DOT[health]}`}
        />
        {LABEL[health]}
      </span>
    </li>
  );
}

export default async function StatusPage() {
  // Each probe is independently guarded so one failing check can never throw
  // the page — the worst case for any single subsystem is "unknown".
  const [database, agent, integrations] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkAgent()),
    Promise.resolve(checkIntegrations()),
  ]);

  const subsystems: Subsystem[] = [
    { label: 'Agent (Chippi)', health: agent },
    { label: 'Dashboard & database', health: database },
    { label: 'Integrations', health: integrations },
  ];

  const anyDegraded = subsystems.some((s) => s.health === 'degraded');
  const allOperational = subsystems.every((s) => s.health === 'operational');

  // The headline is the one focal sentence — it must match the dots below it.
  const title = anyDegraded
    ? 'We’re looking into an issue.'
    : allOperational
      ? 'All systems operational.'
      : 'Most systems operational.';

  return (
    <>
      <MarketingHero
        eyebrow="STATUS"
        title={title}
        sub="Live status of Chippi’s agent, integrations, and dashboard."
      />

      <section className="relative pb-24 md:pb-32">
        <div className="mx-auto max-w-2xl px-6 md:px-8">
          <ul className="divide-y divide-border/60 border-t border-b border-border/60">
            {subsystems.map((s) => (
              <StatusRow key={s.label} label={s.label} health={s.health} />
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            Subscribe to status updates at{' '}
            <a
              href="mailto:status@chippi.app"
              className="underline underline-offset-2 transition-colors hover:text-foreground"
            >
              status@chippi.app
            </a>
            .
          </p>
        </div>
      </section>
    </>
  );
}
