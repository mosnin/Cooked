import { getBrokerContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import Link from 'next/link';
import type { Metadata } from 'next';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { RealtorsClient, type RealtorRow } from './realtors-client';

export const metadata: Metadata = { title: 'Realtors — Teams' };

export default async function BrokerRealtorsPage() {
  const ctx = await getBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage } = ctx;

  const members = await getBrokerageMembers(brokerage.id, { includeOnboard: true, includeSpaceName: true });

  const spaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];

  // 7-day response-time window. Mirrors agent/tools/broker/performance.py
  // (which uses 30 days for the deeper Chippi audit); the inline row pill
  // wants a fresher, shorter window — what's happening THIS week. Same
  // outbound activity types (call/email/meeting) so the two surfaces don't
  // disagree about what "responding" means.
  const RESPONSE_WINDOW_DAYS = 7;
  const RESPONSE_OUTBOUND_TYPES = ['call', 'email', 'meeting'] as const;
  const responseSince = new Date(Date.now() - RESPONSE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();

  // Pull the full health picture per realtor in one parallel volley:
  //   - contactRows       → total people on file (for pipeline context)
  //   - dealRows          → active deals + pipeline value
  //   - wonDealRows       → deals closed (top-performer signal)
  //   - openLeadRows      → contacts tagged new-lead (open lead load)
  //   - unworkedRows      → broker-assigned leads with no first contact
  //   - slaNudgedRows     → leads that have hit the SLA nudge threshold
  //   - slaEscalatedRows  → leads that have escalated to the broker
  //   - recentContactRows → for response-time band (7-day window)
  const [
    contactRows,
    dealRows,
    wonDealRows,
    openLeadRows,
    unworkedRows,
    slaNudgedRows,
    slaEscalatedRows,
    recentContactRows,
  ] = await Promise.all([
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .not('tags', 'cs', '["application-link"]')
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    spaceIds.length > 0
      ? supabase
          .from('Deal')
          .select('spaceId, value')
          .in('spaceId', spaceIds)
          .eq('status', 'active')
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Won deals — top-performer signal: closed something recently
    spaceIds.length > 0
      ? supabase
          .from('Deal')
          .select('spaceId, value')
          .in('spaceId', spaceIds)
          .eq('status', 'won')
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Open lead load — new leads not yet converted
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .contains('tags', ['new-lead'])
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Un-worked broker-assigned leads: assigned but lastContactedAt IS NULL
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .contains('tags', ['assigned-by-broker'])
          .is('lastContactedAt', null)
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Speed-to-lead misses: nudged (breached first-response SLA)
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .contains('tags', ['sla-nudged'])
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Speed-to-lead escalations: breached escalation SLA — the loudest signal
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .contains('tags', ['sla-escalated'])
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Recent contacts for 7-day response-time band
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('id, spaceId, createdAt')
          .in('spaceId', spaceIds)
          .gte('createdAt', responseSince)
          .limit(10000)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  // First outbound activity per contact in the window. One query against
  // ContactActivity instead of N per-space queries — the broker page already
  // has the contact ids in hand.
  const recentContactIds = (recentContactRows as { id: string }[]).map((c) => c.id);
  const activityRows = recentContactIds.length > 0
    ? (await supabase
        .from('ContactActivity')
        .select('contactId, createdAt, type')
        .in('contactId', recentContactIds)
        .in('type', [...RESPONSE_OUTBOUND_TYPES])
        .limit(20000)
        .then((r) => r.data ?? [])) as { contactId: string; createdAt: string; type: string }[]
    : [];

  // First outbound timestamp per contact (only the earliest counts — that's
  // the "first response").
  const firstOutboundByContact = new Map<string, number>();
  for (const a of activityRows) {
    const ts = new Date(a.createdAt).getTime();
    if (Number.isNaN(ts)) continue;
    const prev = firstOutboundByContact.get(a.contactId);
    if (prev === undefined || ts < prev) {
      firstOutboundByContact.set(a.contactId, ts);
    }
  }

  // Per-space response-hour samples. Negative deltas (clock skew or
  // back-dated activity) are dropped — same defensive filter the Python
  // tool applies.
  const samplesBySpace = new Map<string, number[]>();
  for (const c of recentContactRows as { id: string; spaceId: string; createdAt: string }[]) {
    const first = firstOutboundByContact.get(c.id);
    if (first === undefined) continue;
    const created = new Date(c.createdAt).getTime();
    if (Number.isNaN(created)) continue;
    const hours = (first - created) / 3_600_000;
    if (hours < 0) continue;
    if (!samplesBySpace.has(c.spaceId)) samplesBySpace.set(c.spaceId, []);
    samplesBySpace.get(c.spaceId)!.push(hours);
  }

  // Team median across ALL response samples — same definition as the Chippi
  // audit tool. Median (not mean) so a single 200-hour outlier doesn't drag
  // the threshold.
  const allSamples = ([] as number[]).concat(...samplesBySpace.values()).sort((a, b) => a - b);
  const teamMedianHours = allSamples.length > 0
    ? allSamples[Math.floor(allSamples.length / 2)]
    : null;

  // Band multipliers — match agent/tools/broker/performance.py:48-49 so
  // Chippi's narrative answer ("Alice is slow") and the row pill agree.
  const FAST_MULTIPLIER = 0.5;
  const SLOW_MULTIPLIER = 2.0;
  function bandFor(avgHours: number | null): RealtorRow['responseBand'] {
    if (avgHours === null) return 'no_data';
    if (teamMedianHours === null) return 'no_data';
    if (avgHours <= teamMedianHours * FAST_MULTIPLIER) return 'fast';
    if (avgHours >= teamMedianHours * SLOW_MULTIPLIER) return 'slow';
    return 'on_pace';
  }

  // Aggregate per-space counts for all health signals
  function countBySpace(rows: { spaceId: string }[]): Record<string, number> {
    return rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1;
      return acc;
    }, {});
  }

  const peopleBySpace    = countBySpace(contactRows as { spaceId: string }[]);
  const openLeadsBySpace = countBySpace(openLeadRows as { spaceId: string }[]);
  const unworkedBySpace  = countBySpace(unworkedRows as { spaceId: string }[]);
  const nudgedBySpace    = countBySpace(slaNudgedRows as { spaceId: string }[]);
  const escalatedBySpace = countBySpace(slaEscalatedRows as { spaceId: string }[]);

  const dealsBySpace = (dealRows as { spaceId: string; value: number | null }[]).reduce<
    Record<string, { count: number; value: number }>
  >(
    (acc, r) => {
      if (!acc[r.spaceId]) acc[r.spaceId] = { count: 0, value: 0 };
      acc[r.spaceId].count += 1;
      acc[r.spaceId].value += r.value ?? 0;
      return acc;
    },
    {}
  );

  const wonBySpace = (wonDealRows as { spaceId: string; value: number | null }[]).reduce<
    Record<string, { count: number; value: number }>
  >(
    (acc, r) => {
      if (!acc[r.spaceId]) acc[r.spaceId] = { count: 0, value: 0 };
      acc[r.spaceId].count += 1;
      acc[r.spaceId].value += r.value ?? 0;
      return acc;
    },
    {}
  );

  const realtors: RealtorRow[] = members.map((m) => {
    const sid = m.Space?.id ?? null;
    const samples = sid ? samplesBySpace.get(sid) ?? [] : [];
    const avgHours = samples.length > 0
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : null;

    const openLeads = sid ? (openLeadsBySpace[sid] ?? 0) : 0;
    const unworked  = sid ? (unworkedBySpace[sid]  ?? 0) : 0;
    const slaMisses = sid ? ((nudgedBySpace[sid] ?? 0) + (escalatedBySpace[sid] ?? 0)) : 0;
    const dealsWon  = sid ? (wonBySpace[sid]?.count ?? 0) : 0;

    // Health tier — needs-attention surfaces first so the broker acts;
    // top-performer is last so they get recognised without dominating.
    //   needs-attention = un-worked broker leads OR SLA misses (letting leads sit)
    //   top-performer   = won at least one deal AND no SLA misses AND no un-worked
    //   on-track        = everything in between
    let health: RealtorRow['health'];
    if (!m.User?.onboard) {
      health = 'pending';
    } else if (unworked > 0 || slaMisses > 0) {
      health = 'needs-attention';
    } else if (dealsWon > 0 && slaMisses === 0 && unworked === 0) {
      health = 'top-performer';
    } else {
      health = 'on-track';
    }

    return {
      membershipId: m.id,
      userId: m.userId,
      name: m.User?.name ?? null,
      email: m.User?.email ?? '',
      onboard: m.User?.onboard ?? false,
      role: m.role,
      spaceSlug: m.Space?.slug ?? null,
      people:   sid ? (peopleBySpace[sid] ?? 0) : 0,
      deals:    sid ? (dealsBySpace[sid]?.count ?? 0) : 0,
      pipeline: sid ? (dealsBySpace[sid]?.value ?? 0) : 0,
      dealsWon,
      openLeads,
      unworked,
      slaMisses,
      responseAvgHours: avgHours === null ? null : Math.round(avgHours * 10) / 10,
      responseBand: bandFor(avgHours),
      health,
    };
  });

  // ── Status-sentence header: accountability-first framing ──────────────────
  const subtitle = (() => {
    if (realtors.length === 0) {
      return 'No realtors yet. Send the first invite.';
    }
    const active = realtors.filter((r) => r.onboard);
    if (active.length === 0) {
      return `${realtors.length} invited. Nobody onboard yet.`;
    }
    const needsAttention = active.filter((r) => r.health === 'needs-attention');
    const topPerformers  = active.filter((r) => r.health === 'top-performer');
    if (needsAttention.length > 0 && topPerformers.length > 0) {
      return `${needsAttention.length} ${needsAttention.length === 1 ? 'needs' : 'need'} your attention, ${topPerformers.length} crushing it.`;
    }
    if (needsAttention.length > 0) {
      return `${needsAttention.length} ${needsAttention.length === 1 ? 'needs' : 'need'} your attention.`;
    }
    if (topPerformers.length > 0) {
      const firstName = (topPerformers[0].name ?? topPerformers[0].email).split(/\s+/)[0];
      return `${firstName} is crushing it. Team is on track.`;
    }
    return `${active.length} active. Team is on track.`;
  })();

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-56 md:pb-24">
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Realtors.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Your team in flight
        </h1>
        <p className={cn(BODY_MUTED)}>{subtitle}</p>
      </header>

      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <p className="text-sm text-foreground">No realtors yet.</p>
          <p className={cn('text-xs mt-1', BODY_MUTED)}>
            <Link
              href="/broker/invitations"
              className="text-foreground underline underline-offset-2 hover:no-underline"
            >
              Send the first invite
            </Link>{' '}
            to get someone working.
          </p>
        </div>
      ) : (
        <RealtorsClient realtors={realtors} />
      )}
    </div>
  );
}
