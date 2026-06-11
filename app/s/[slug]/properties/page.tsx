import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getSpaceFromSlug, getSpaceForUser } from '@/lib/space';
import { formatCurrency } from '@/lib/formatting';
import { formatPropertyAddress, formatPropertyFacts } from '@/lib/properties';
import { H1, TITLE_FONT, BODY_MUTED, PAGE_MAX, PRIMARY_PILL } from '@/lib/typography';
import type { Property } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PropertyStatusBadge } from '@/components/properties/property-status-badge';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';

export default async function PropertiesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const userSpace = await getSpaceForUser(userId);
  if (!userSpace || userSpace.id !== space.id) redirect('/');

  let properties: Property[] = [];
  let fetchError = false;
  try {
    const { data, error } = await supabase
      .from('Property')
      .select('*')
      .or(`spaceId.eq.${space.id},assignedSpaceId.eq.${space.id}`)
      .order('createdAt', { ascending: false });
    if (error) throw error;
    properties = (data ?? []) as Property[];
  } catch (err) {
    console.error('[properties/page] DB query failed', { slug, error: err });
    fetchError = true;
  }

  if (fetchError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className={cn(BODY_MUTED)}>
            We couldn&apos;t load your properties. This is usually temporary.
          </p>
          <a
            href={`/s/${slug}/properties`}
            className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6 mx-auto pb-12', PAGE_MAX)}>
      {/* Page header — status-sentence pattern: muted greeting → serif h1
          → one-sentence status. Add-listing CTA sits inline; primary
          action lives where the realtor's eye lands after the title. */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <p className={cn(BODY_MUTED)}>Properties.</p>
          <h1 className={cn(H1)} style={TITLE_FONT}>
            All properties
          </h1>
          <p className={cn(BODY_MUTED)}>
            {properties.length === 0
              ? 'No properties yet.'
              : `${properties.length} ${properties.length === 1 ? 'property' : 'properties'}`}
          </p>
        </div>
        <Link
          href={`/s/${slug}/properties/new`}
          className={cn(PRIMARY_PILL, 'inline-flex items-center gap-1.5 flex-shrink-0')}
        >
          <Plus size={14} aria-hidden />
          Add property
        </Link>
      </header>

      {/* Empty state — calm fact, not a directive. */}
      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <Building2 size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-foreground">Quiet — no properties yet.</p>
          <p className={cn('text-xs mt-1', BODY_MUTED)}>
            Add your first listing to start the register.
          </p>
          <Link
            href={`/s/${slug}/properties/new`}
            className={cn(PRIMARY_PILL, 'inline-flex items-center gap-1.5 mt-4')}
          >
            <Plus size={14} aria-hidden />
            Add property
          </Link>
        </div>
      ) : (
        /* divide-y row list — mirrors the deal-property-picker pattern.
           Thumbnail (4:3 ~128px) + facts on the right. A property list is
           a working register, not a gallery; rows let the realtor scan
           facts horizontally without the 4-column grid feeling like a
           spreadsheet export. */
        <StaggerList stagger={0.03} className="divide-y divide-border/60">
          {properties.map((property) => {
            const addr = formatPropertyAddress(property);
            const facts = formatPropertyFacts(property);
            const cover = property.photos[0];

            return (
              <StaggerItem key={property.id}>
                <Link
                  href={`/s/${slug}/properties/${property.id}`}
                  className="flex items-center gap-4 py-4 -mx-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="w-[128px] aspect-[4/3] rounded-md bg-muted overflow-hidden flex-shrink-0">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt={addr}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                        <Building2 size={20} aria-hidden />
                      </div>
                    )}
                  </div>

                  {/* Facts */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground truncate">{addr}</p>
                    {facts && (
                      <p className="text-xs text-muted-foreground truncate">{facts}</p>
                    )}
                    <div className="flex items-center gap-2 pt-0.5">
                      <PropertyStatusBadge status={property.listingStatus} />
                      {property.propertyType && (
                        <span className="text-xs text-muted-foreground">
                          · {property.propertyType.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Price column — tabular nums, right-aligned, hidden on
                      narrow screens so the row never wraps awkwardly. */}
                  <div className="hidden sm:block flex-shrink-0 text-right">
                    {property.listPrice != null ? (
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(property.listPrice)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No price</p>
                    )}
                  </div>
                </Link>
              </StaggerItem>
            );
          })}
        </StaggerList>
      )}
    </div>
  );
}
