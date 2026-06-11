import { redirect } from 'next/navigation';
import { isPlatformAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { SpaceListClient } from './space-list-client';

export const metadata = { title: 'Spaces — Admin — Chippi' };

export default async function AdminSpacesPage() {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) redirect('/');

  const { data: spaces, error } = await supabase
    .from('Space')
    .select(
      'id, slug, name, emoji, ownerId, brokerageId, createdAt, stripeCustomerId, stripeSubscriptionId, stripeSubscriptionStatus, stripePeriodEnd'
    )
    .order('createdAt', { ascending: false })
    .limit(200);

  if (error) throw error;

  const ownerIds = [
    ...new Set((spaces ?? []).map((s) => s.ownerId).filter(Boolean)),
  ];

  const { data: owners, error: ownerError } =
    ownerIds.length > 0
      ? await supabase
          .from('User')
          .select('id, name, email')
          .in('id', ownerIds)
      : { data: [], error: null };

  if (ownerError) throw ownerError;

  const ownerMap: Record<string, { id: string; name: string | null; email: string }> = {};
  for (const o of owners ?? []) {
    ownerMap[o.id] = { id: o.id, name: o.name, email: o.email };
  }

  const totalCount = spaces?.length ?? 0;

  return (
    <div className="space-y-8 pb-12 max-w-5xl mx-auto">
      <header className="space-y-1.5">
        <p className="text-sm text-muted-foreground">Management.</p>
        <h1
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          Spaces
        </h1>
        <p className="text-sm text-muted-foreground">{totalCount} total spaces.</p>
      </header>

      <SpaceListClient
        spaces={(spaces ?? []).map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          emoji: s.emoji,
          ownerId: s.ownerId,
          brokerageId: s.brokerageId,
          createdAt: s.createdAt,
          stripeSubscriptionStatus: s.stripeSubscriptionStatus,
          stripePeriodEnd: s.stripePeriodEnd,
        }))}
        ownerMap={ownerMap}
        totalCount={totalCount}
      />
    </div>
  );
}
