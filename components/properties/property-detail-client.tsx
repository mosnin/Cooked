'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Pencil, Trash2, ExternalLink, Building2, Briefcase, CalendarDays, Share2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Property } from '@/lib/types';
import { formatCurrency } from '@/lib/formatting';
import { formatPropertyAddress, formatPropertyFacts } from '@/lib/properties';
import { SECTION_LABEL } from '@/lib/typography';
import { Button } from '@/components/ui/button';
import { PropertyForm } from './property-form';
import { PropertyShareDialog } from './property-share-dialog';
import { PropertyStatusBadge } from './property-status-badge';

/** Apple ease-out cubic — entrances. */
const EASE_APPLE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface Props {
  slug: string;
  initial: Property;
  linkedDeals: { id: string; title: string; status: string; value: number | null; closeDate: string | null }[];
  linkedTours: { id: string; guestName: string; startsAt: string; status: string }[];
}

export function PropertyDetailClient({ slug, initial, linkedDeals, linkedTours }: Props) {
  const router = useRouter();
  const [property, setProperty] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function save(values: Partial<Property>) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Couldn't save that. Try again.");
        return;
      }
      const updated: Property = await res.json();
      setProperty(updated);
      setEditing(false);
      toast.success('Saved.');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this property? Linked deals and tours stay intact.')) return;
    const res = await fetch(`/api/properties/${property.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error("Couldn't delete that property."); return; }
    toast.success('Deleted.');
    router.push(`/s/${slug}/properties`);
  }

  const cover = property.photos[0];
  const addr = formatPropertyAddress(property);
  const facts = formatPropertyFacts(property);

  if (editing) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-5">
        <h1 className="text-lg font-semibold mb-4">Edit property</h1>
        <PropertyForm
          initial={property}
          onCancel={() => setEditing(false)}
          onSubmit={save}
          submitting={submitting}
          submitLabel="Save changes"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Hero ────────────────────────────────────────────────────────
          Full-width 16:9 photo. Real estate leads with the photo — the
          old 360px sidebar treatment hid it behind chrome. When no photo
          is on file: same aspect ratio, hairline border, calm muted copy
          (not a coloured block). */}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
        {cover ? (
          // Hero entrance — tiny 1.02→1 settle + fade-in over 250ms. The
          // scale is intentionally below the spec ceiling so the photo
          // never reads as "zooming in" — only as landing into place.
          <motion.img
            src={cover}
            alt={addr}
            className="aspect-video w-full object-cover"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: EASE_APPLE }}
          />
        ) : (
          <div className="aspect-video w-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Building2 size={28} className="text-muted-foreground/50" aria-hidden />
            <p className="text-xs text-muted-foreground">No photo on file yet.</p>
          </div>
        )}
      </div>

      {/* ── Title + status sentence ─────────────────────────────────────
          Page-level focal: serif Times h1 + status pill row + price.
          Same vocabulary as the contact detail page. */}
      <header className="space-y-2">
        <h1
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          {addr}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <PropertyStatusBadge status={property.listingStatus} />
          {property.propertyType && (
            <span>· {property.propertyType.replace('_', ' ')}</span>
          )}
          {facts && <span>· {facts}</span>}
        </div>
        {property.listPrice != null && (
          <p
            className="text-3xl tracking-tight text-foreground tabular-nums pt-2"
            style={{ fontFamily: 'var(--font-title)' }}
          >
            {formatCurrency(property.listPrice)}
          </p>
        )}
      </header>

      {/* ── Facts grid + listing/notes ───────────────────────────────── */}
      <section className="space-y-4 border-t border-border/60 pt-6">
        {(property.yearBuilt != null || property.lotSizeSqft != null || property.mlsNumber) && (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            {property.yearBuilt != null && <Fact label="Year built" value={String(property.yearBuilt)} />}
            {property.lotSizeSqft != null && <Fact label="Lot" value={`${property.lotSizeSqft.toLocaleString()} sqft`} />}
            {property.mlsNumber && <Fact label="MLS" value={property.mlsNumber} />}
          </dl>
        )}

        {property.listingUrl && (
          <a
            href={property.listingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
          >
            View listing <ExternalLink size={12} />
          </a>
        )}

        {property.notes && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {property.notes}
          </p>
        )}
      </section>

      {/* ── Action row ──────────────────────────────────────────────────
          Canonical Button components — outline for Share, default for
          Edit (primary), destructive for Delete. */}
      <div className="flex items-center justify-between border-t border-border/60 pt-6">
        <Button variant="destructive" size="sm" onClick={remove}>
          <Trash2 /> Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSharing(true)}>
            <Share2 /> Share
          </Button>
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        </div>
      </div>

      {/* ── Linked deals + tours ────────────────────────────────────────
          Below the facts, not in a sidebar. Section labels use the
          canonical SECTION_LABEL small-caps treatment. */}
      <div className="space-y-8 border-t border-border/60 pt-6">
        <LinkedSection
          title="Linked deals"
          icon={Briefcase}
          empty="No deals linked to this property yet."
          items={linkedDeals.map((d) => ({
            key: d.id,
            href: `/s/${slug}/deals/${d.id}`,
            primary: d.title,
            secondary: [
              d.status !== 'active' ? d.status : null,
              d.value != null ? formatCurrency(d.value) : null,
              d.closeDate ? `Closes ${new Date(d.closeDate).toLocaleDateString()}` : null,
            ].filter(Boolean).join(' · '),
          }))}
        />
        <LinkedSection
          title="Tours"
          icon={CalendarDays}
          empty="No tours have been scheduled here yet."
          items={linkedTours.map((t) => {
            const d = new Date(t.startsAt);
            return {
              key: t.id,
              href: `/s/${slug}/calendar`,
              primary: t.guestName,
              secondary: `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
            };
          })}
        />
      </div>

      {sharing && (
        <PropertyShareDialog
          propertyId={property.id}
          linkedDealIds={linkedDeals.map((d) => d.id)}
          origin={origin}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={cn(SECTION_LABEL, 'mb-0.5')}>{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function LinkedSection({
  title,
  icon: Icon,
  items,
  empty,
}: {
  title: string;
  icon: typeof Briefcase;
  items: { key: string; href: string; primary: string; secondary: string }[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={12} className="text-muted-foreground" aria-hidden />
        <h2 className={cn(SECTION_LABEL)}>{title}</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-center gap-3 py-3 -mx-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item.primary}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.secondary}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
