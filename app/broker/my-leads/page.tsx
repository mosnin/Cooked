import { getBrokerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { HOT_LEAD_THRESHOLD, WARM_LEAD_THRESHOLD } from '@/lib/constants';
import { PhoneIncoming, Briefcase, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  BODY_MUTED,
  H1,
  SECTION_LABEL,
  TITLE_FONT,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/formatting';

export const metadata: Metadata = { title: 'My Leads — Chippi' };

export default async function MyLeadsPage() {
  const ctx = await getBrokerMemberContext();
  if (!ctx) redirect('/');

  const { brokerage, dbUserId } = ctx;

  // Find the member's personal Space
  const { data: space } = await supabase
    .from('Space')
    .select('id, slug, name')
    .eq('ownerId', dbUserId)
    .maybeSingle();

  if (!space) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto pb-56 md:pb-24">
        <header className="space-y-1.5">
          <p className={BODY_MUTED}>Your routed leads.</p>
          <h1 className={H1} style={TITLE_FONT}>
            On your plate
          </h1>
          <p className={BODY_MUTED}>{brokerage.name} hasn&rsquo;t routed anything yet.</p>
        </header>
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <Briefcase size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
          <p className="text-base text-foreground">Finish your workspace.</p>
          <p className={cn(BODY_MUTED, 'mt-1.5')}>
            <Link
              href="/setup"
              className="text-foreground underline underline-offset-2 hover:no-underline"
            >
              Complete setup
            </Link>{' '}
            so I can land routed leads here.
          </p>
        </div>
      </div>
    );
  }

  // Query contacts with tag 'assigned-by-broker'
  const { data: contacts } = await supabase
    .from('Contact')
    .select(
      'id, name, phone, email, leadScore, scoreLabel, tags, sourceLabel, createdAt, lastContactedAt',
    )
    .eq('spaceId', space.id)
    .contains('tags', ['assigned-by-broker'])
    .order('createdAt', { ascending: false })
    .limit(100);

  const leads = (contacts ?? []) as Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    leadScore: number | null;
    scoreLabel: string | null;
    tags: string[];
    sourceLabel: string | null;
    createdAt: string;
    lastContactedAt: string | null;
  }>;

  function scorePill(scoreLabel: string | null, leadScore: number | null) {
    if (!scoreLabel && leadScore == null) return null;
    const label = scoreLabel ?? `${leadScore}`;
    const isHot =
      scoreLabel?.toLowerCase() === 'hot' ||
      (leadScore != null && leadScore >= HOT_LEAD_THRESHOLD);
    const isWarm =
      scoreLabel?.toLowerCase() === 'warm' ||
      (leadScore != null && leadScore >= WARM_LEAD_THRESHOLD);
    const className = isHot
      ? 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15'
      : isWarm
        ? 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15'
        : 'text-muted-foreground bg-muted/60';
    return (
      <span
        className={cn(
          'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0',
          className,
        )}
      >
        {label}
      </span>
    );
  }

  // Subtitle — one-sentence Chippi voice, count-aware. Mirrors the realtor
  // pattern on /contacts: muted greeting → serif title → status.
  const uncontactedCount = leads.filter((l) => !l.lastContactedAt).length;
  const subtitle = (() => {
    if (leads.length === 0) {
      return `Nothing routed yet from ${brokerage.name}.`;
    }
    if (uncontactedCount > 0) {
      return `${leads.length} on your plate · ${uncontactedCount} haven’t heard from you yet.`;
    }
    return `${leads.length} on your plate. You’re on top of it.`;
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-56 md:pb-24">
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Your routed leads.</p>
        <h1 className={H1} style={TITLE_FONT}>
          On your plate
        </h1>
        <p className={BODY_MUTED}>{subtitle}</p>
      </header>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <PhoneIncoming
            size={28}
            className="mx-auto mb-3 text-muted-foreground/60"
            aria-hidden
          />
          <p className="text-base text-foreground">Nothing here yet.</p>
          <p className={cn(BODY_MUTED, 'mt-1.5')}>
            When {brokerage.name} routes a lead to you, I&rsquo;ll land it here.
          </p>
        </div>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center gap-3 pb-3 border-b border-border/60">
            <h2 className={SECTION_LABEL}>Routed to you</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {leads.length}
            </span>
            {uncontactedCount > 0 && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {uncontactedCount} not yet contacted
              </span>
            )}
          </div>
          <ul className="divide-y divide-border/60">
            {leads.map((lead) => {
              const contacted = !!lead.lastContactedAt;
              return (
                <li key={lead.id}>
                  <Link
                    href={`/s/${space.slug}/leads/${lead.id}`}
                    className="group/row flex items-center gap-3 py-3 px-2 -mx-2 rounded-md hover:bg-muted/30 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
                      {getInitials(lead.name || lead.email || '?')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">
                          {lead.name || 'Unnamed'}
                        </span>
                        {scorePill(lead.scoreLabel, lead.leadScore)}
                        {!contacted && (
                          <span className="inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15">
                            New
                          </span>
                        )}
                      </div>
                      {(lead.email || lead.phone) && (
                        <div className="mt-0.5 text-xs text-muted-foreground truncate">
                          {lead.email && <span>{lead.email}</span>}
                          {lead.email && lead.phone && (
                            <span className="text-muted-foreground/40"> · </span>
                          )}
                          {lead.phone && (
                            <span className="tabular-nums">{lead.phone}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="hidden sm:inline text-[11px] text-muted-foreground tabular-nums">
                        {new Date(lead.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <ChevronRight
                        size={14}
                        className="text-muted-foreground/40 flex-shrink-0"
                        aria-hidden
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
