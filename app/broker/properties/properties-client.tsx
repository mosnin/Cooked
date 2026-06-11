'use client';

/**
 * BrokerPropertiesClient — the interactive shell for /broker/properties.
 *
 * Row/card layout pixel-matches app/s/[slug]/properties/page.tsx:
 * divide-y rows, 128px 4:3 thumbnail, StaggerList entrance, status badge,
 * facts line, price column, empty-state pattern, status-sentence header.
 *
 * Broker-only additions layered on top:
 *   1. Ownership badge — each row shows the assigned realtor name (or
 *      "Available" when unassigned) so the broker can scan at a glance.
 *   2. Assign control — a compact native <select> that PATCHes
 *      /api/broker/properties/[id]/assign on change. Stops row click
 *      propagation so hover state doesn't confuse intent.
 *   3. Add property panel — inline form that POSTs to /api/broker/properties
 *      with an assign-on-create field. Toggled from the header CTA.
 *
 * API contract (unchanged):
 *   GET  /api/broker/properties         -> { properties, members }
 *   POST /api/broker/properties         -> Property
 *   PATCH /api/broker/properties/[id]/assign -> Property
 */

import { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Loader2, X, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED, PRIMARY_PILL } from '@/lib/typography';
import {
  formatPropertyAddress,
  formatPropertyFacts,
  PROPERTY_TYPE_OPTIONS,
  PROPERTY_LISTING_STATUS_OPTIONS,
} from '@/lib/properties';
import { formatCurrency } from '@/lib/formatting';
import { PropertyStatusBadge } from '@/components/properties/property-status-badge';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toastError, toastSuccess } from '@/lib/toast-helpers';
import type { Property, PropertyListingStatus, PropertyType } from '@/lib/types';

interface MemberSpace {
  id: string;
  name: string;
  ownerName: string | null;
}

// ── Skeleton row — placeholder while data is in flight ─────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="w-[128px] aspect-[4/3] rounded-md bg-muted animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-48 rounded bg-muted animate-pulse" />
        <div className="h-3 w-32 rounded bg-muted animate-pulse" />
        <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
      </div>
      <div className="hidden sm:flex flex-col items-end gap-1.5">
        <div className="w-20 h-4 rounded bg-muted animate-pulse" />
        <div className="w-24 h-5 rounded-full bg-muted animate-pulse" />
      </div>
      <div className="hidden sm:block w-[180px] h-7 rounded-md bg-muted animate-pulse flex-shrink-0" />
    </div>
  );
}

// ── Ownership badge — reads as "assigned to X" or "Available" ──────────────
// "Available" uses a dashed border + muted tint so unassigned properties
// read as slots ready to be claimed, not as missing data.

interface OwnershipBadgeProps {
  member: MemberSpace | undefined;
}

function OwnershipBadge({ member }: OwnershipBadgeProps) {
  if (member) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
          'text-[11px] font-medium',
          'bg-muted text-foreground',
        )}
      >
        <UserCheck size={11} aria-hidden />
        {member.ownerName ?? member.name}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        'text-[11px] font-medium',
        'bg-muted/60 text-muted-foreground border border-dashed border-border/60',
      )}
    >
      Available
    </span>
  );
}

// ── Assign dropdown ─────────────────────────────────────────────────────────

interface AssignControlProps {
  property: Property;
  members: MemberSpace[];
  onAssigned: (propertyId: string, assignedSpaceId: string | null) => void;
}

function AssignControl({ property, members, onAssigned }: AssignControlProps) {
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const spaceId = e.target.value || null;
    setSaving(true);
    try {
      const res = await fetch(`/api/broker/properties/${property.id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedSpaceId: spaceId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toastError(body.error ?? 'Assignment failed.');
        return;
      }
      const updated = (await res.json()) as Property;
      onAssigned(updated.id, updated.assignedSpaceId ?? null);
      const memberName = members.find((m) => m.id === spaceId)?.ownerName;
      if (spaceId && memberName) {
        toastSuccess(`Assigned to ${memberName}.`);
      } else {
        toastSuccess('Unassigned.');
      }
    } catch {
      toastError('Assignment failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectClasses = cn(
    'flex h-7 w-full min-w-0 max-w-[180px] rounded-md border border-input bg-transparent',
    'px-2 py-0 text-xs transition-colors duration-150 outline-none',
    'dark:bg-input/30',
    'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
    'focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    saving && 'opacity-60',
  );

  return (
    <div
      className="flex items-center gap-1.5 flex-shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      {saving && (
        <Loader2 size={11} className="animate-spin text-muted-foreground" aria-hidden />
      )}
      <select
        value={property.assignedSpaceId ?? ''}
        onChange={handleChange}
        disabled={saving}
        className={selectClasses}
        aria-label="Assign to realtor"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.ownerName ?? m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Add-property inline form ─────────────────────────────────────────────────
// Mirrors the field structure of components/properties/property-form.tsx.
// Cannot reuse PropertyForm directly because the broker form adds an
// assign-on-create field and posts to the broker API. Field layout,
// select styling, and Field component are identical to the shared form.

interface AddPropertyFormProps {
  members: MemberSpace[];
  onCreated: (p: Property) => void;
  onCancel: () => void;
}

type FormValues = {
  address: string;
  unitNumber: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  mlsNumber: string;
  listingUrl: string;
  propertyType: PropertyType | '';
  listingStatus: PropertyListingStatus;
  beds: string;
  baths: string;
  squareFeet: string;
  lotSizeSqft: string;
  yearBuilt: string;
  listPrice: string;
  notes: string;
  assignedSpaceId: string;
};

const EMPTY_FORM: FormValues = {
  address: '',
  unitNumber: '',
  city: '',
  stateRegion: '',
  postalCode: '',
  mlsNumber: '',
  listingUrl: '',
  propertyType: '',
  listingStatus: 'active',
  beds: '',
  baths: '',
  squareFeet: '',
  lotSizeSqft: '',
  yearBuilt: '',
  listPrice: '',
  notes: '',
  assignedSpaceId: '',
};

function AddPropertyForm({ members, onCreated, onCancel }: AddPropertyFormProps) {
  const [v, setV] = useState<FormValues>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const address = v.address.trim();
    if (!address) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        address,
        unitNumber: v.unitNumber.trim() || null,
        city: v.city.trim() || null,
        stateRegion: v.stateRegion.trim() || null,
        postalCode: v.postalCode.trim() || null,
        mlsNumber: v.mlsNumber.trim() || null,
        listingUrl: v.listingUrl.trim() || null,
        propertyType: v.propertyType || null,
        listingStatus: v.listingStatus,
        beds: v.beds !== '' ? Number(v.beds) : null,
        baths: v.baths !== '' ? Number(v.baths) : null,
        squareFeet: v.squareFeet !== '' ? Number(v.squareFeet) : null,
        lotSizeSqft: v.lotSizeSqft !== '' ? Number(v.lotSizeSqft) : null,
        yearBuilt: v.yearBuilt !== '' ? Number(v.yearBuilt) : null,
        listPrice: v.listPrice !== '' ? Number(v.listPrice) : null,
        notes: v.notes.trim() || null,
        assignedSpaceId: v.assignedSpaceId || null,
      };

      const res = await fetch('/api/broker/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        toastError(errBody.error ?? "Couldn't create that property.");
        return;
      }

      const created = (await res.json()) as Property;
      onCreated(created);
      toastSuccess('Property added to pool.');
    } catch {
      toastError("Couldn't create that property. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Native <select> styled to match <Input> — same height, border, radius,
  // padding, focus ring. Mirrors the approach in property-form.tsx exactly.
  const selectClasses = cn(
    'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1',
    'text-base transition-colors duration-150 outline-none md:text-sm',
    'dark:bg-input/30',
    'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
    'focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
  );

  return (
    <div className="rounded-xl border border-border/70 bg-card px-5 py-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-foreground">New pool property</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Address row — mirrors property-form.tsx layout */}
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <FormField label="Address" required>
            <Input
              type="text"
              required
              value={v.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="123 Main St"
            />
          </FormField>
          <FormField label="Unit">
            <Input
              type="text"
              value={v.unitNumber}
              onChange={(e) => set('unitNumber', e.target.value)}
              placeholder="4B"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <FormField label="City">
            <Input
              type="text"
              value={v.city}
              onChange={(e) => set('city', e.target.value)}
            />
          </FormField>
          <FormField label="State">
            <Input
              type="text"
              value={v.stateRegion}
              onChange={(e) => set('stateRegion', e.target.value)}
            />
          </FormField>
          <FormField label="ZIP">
            <Input
              type="text"
              value={v.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="MLS #">
            <Input
              type="text"
              value={v.mlsNumber}
              onChange={(e) => set('mlsNumber', e.target.value)}
              placeholder="Unique identifier"
            />
          </FormField>
          <FormField label="Listing URL">
            <Input
              type="url"
              value={v.listingUrl}
              onChange={(e) => set('listingUrl', e.target.value)}
              placeholder="https://..."
            />
          </FormField>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <FormField label="Type">
            <select
              value={v.propertyType}
              onChange={(e) =>
                set('propertyType', (e.target.value || '') as PropertyType | '')
              }
              className={selectClasses}
            >
              <option value="">—</option>
              {PROPERTY_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Status">
            <select
              value={v.listingStatus}
              onChange={(e) =>
                set('listingStatus', e.target.value as PropertyListingStatus)
              }
              className={selectClasses}
            >
              {PROPERTY_LISTING_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Beds">
            <Input
              type="number"
              step="0.5"
              min="0"
              value={v.beds}
              onChange={(e) => set('beds', e.target.value)}
            />
          </FormField>
          <FormField label="Baths">
            <Input
              type="number"
              step="0.5"
              min="0"
              value={v.baths}
              onChange={(e) => set('baths', e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <FormField label="Sq ft">
            <Input
              type="number"
              min="0"
              value={v.squareFeet}
              onChange={(e) => set('squareFeet', e.target.value)}
            />
          </FormField>
          <FormField label="Lot (sqft)">
            <Input
              type="number"
              min="0"
              value={v.lotSizeSqft}
              onChange={(e) => set('lotSizeSqft', e.target.value)}
            />
          </FormField>
          <FormField label="Year built">
            <Input
              type="number"
              min="1600"
              max="2200"
              value={v.yearBuilt}
              onChange={(e) => set('yearBuilt', e.target.value)}
            />
          </FormField>
          <FormField label="List price">
            <Input
              type="number"
              min="0"
              step="1000"
              value={v.listPrice}
              onChange={(e) => set('listPrice', e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Notes">
          <Textarea
            value={v.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            placeholder="Anything the team should know about this property."
          />
        </FormField>

        {/* Assign on create — broker-only field not in PropertyForm */}
        {members.length > 0 && (
          <FormField label="Assign to realtor">
            <select
              value={v.assignedSpaceId}
              onChange={(e) => set('assignedSpaceId', e.target.value)}
              className={selectClasses}
            >
              <option value="">Unassigned — add to pool</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.ownerName ?? m.name}
                </option>
              ))}
            </select>
          </FormField>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || !v.address.trim()}
          >
            {submitting && <Loader2 className="animate-spin" />}
            Add to pool
          </Button>
        </div>
      </form>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}

// ── Main client component ───────────────────────────────────────────────────
// Owns its own header (status-sentence pattern) and the add-form toggle.
// No props required from the server page — the component is self-contained.

export function BrokerPropertiesClient() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [members, setMembers] = useState<MemberSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchFailed(false);
    try {
      const res = await fetch('/api/broker/properties');
      if (!res.ok) throw new Error('fetch failed');
      const body = (await res.json()) as {
        properties: Property[];
        members: MemberSpace[];
      };
      setProperties(body.properties ?? []);
      setMembers(body.members ?? []);
    } catch {
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Update a single property's assignedSpaceId in local state.
  function handleAssigned(propertyId: string, assignedSpaceId: string | null) {
    setProperties((prev) =>
      prev.map((p) => (p.id === propertyId ? { ...p, assignedSpaceId } : p)),
    );
  }

  // Prepend a newly-created property and close the form.
  function handleCreated(p: Property) {
    setProperties((prev) => [p, ...prev]);
    setShowAddForm(false);
  }

  // ── Loading state — skeleton rows while fetch is in flight ──────────────
  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton header */}
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="h-4 w-20 rounded bg-muted animate-pulse" />
            <div className="h-8 w-48 rounded bg-muted animate-pulse" />
            <div className="h-4 w-28 rounded bg-muted animate-pulse" />
          </div>
          <div className="h-9 w-32 rounded-full bg-muted animate-pulse flex-shrink-0" />
        </header>
        <div className="divide-y divide-border/60">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (fetchFailed) {
    return (
      <div className="space-y-6">
        <header className="space-y-1.5">
          <p className={cn(BODY_MUTED)}>Properties.</p>
          <h1 className={cn(H1)} style={TITLE_FONT}>
            Pool properties
          </h1>
        </header>
        <div className="rounded-xl border border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">Couldn&apos;t load the pool.</p>
          <p className={cn('text-xs mt-1', BODY_MUTED)}>
            This is usually temporary.{' '}
            <button
              type="button"
              onClick={load}
              className="underline underline-offset-2 hover:no-underline text-foreground"
            >
              Try again
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  const count = properties.length;
  const statusSentence =
    count === 0
      ? 'No properties in the pool yet.'
      : `${count} ${count === 1 ? 'property' : 'properties'} in the pool.`;

  return (
    <div className="space-y-6">
      {/* Page header — status-sentence pattern matching the realtor properties
          page: muted greeting line -> serif h1 -> one-sentence status.
          Add-property CTA sits inline, right-aligned. */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <p className={cn(BODY_MUTED)}>Properties.</p>
          <h1 className={cn(H1)} style={TITLE_FONT}>
            Pool properties
          </h1>
          <p className={cn(BODY_MUTED)}>{statusSentence}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className={cn(PRIMARY_PILL, 'flex-shrink-0')}
        >
          <Plus size={14} aria-hidden />
          Add property
        </button>
      </header>

      {/* Inline add form — appears between header and list */}
      {showAddForm && (
        <AddPropertyForm
          members={members}
          onCreated={handleCreated}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Empty state */}
      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <Building2
            size={28}
            className="mx-auto mb-3 text-muted-foreground/60"
            aria-hidden
          />
          <p className="text-sm text-foreground">
            Quiet — no properties in the pool yet.
          </p>
          <p className={cn('text-xs mt-1', BODY_MUTED)}>
            Add the first listing to start assigning to your realtors.
          </p>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className={cn(PRIMARY_PILL, 'mt-4')}
          >
            <Plus size={14} aria-hidden />
            Add property
          </button>
        </div>
      ) : (
        /* divide-y row list — pixel-matches the realtor properties page.
           Thumbnail (128px 4:3) + facts column + price column + assign control.
           Two broker-specific elements per row:
             - OwnershipBadge (in the facts line, after status/type)
             - AssignControl (rightmost column, hidden on mobile) */
        <StaggerList stagger={0.03} className="divide-y divide-border/60">
          {properties.map((property) => {
            const addr = formatPropertyAddress(property);
            const facts = formatPropertyFacts(property);
            const cover = property.photos?.[0];
            const assignedMember = members.find(
              (m) => m.id === property.assignedSpaceId,
            );

            return (
              <StaggerItem key={property.id}>
                <div className="flex items-center gap-4 py-4 -mx-2 px-2 rounded-md hover:bg-foreground/[0.04] transition-colors">
                  {/* Thumbnail — 128px wide, 4:3 aspect, matches realtor page */}
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

                  {/* Facts column — address, specs line, status badge,
                      property type, and ownership badge */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {addr}
                    </p>
                    {facts && (
                      <p className="text-xs text-muted-foreground truncate">
                        {facts}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                      <PropertyStatusBadge status={property.listingStatus} />
                      {property.propertyType && (
                        <span className="text-xs text-muted-foreground">
                          · {property.propertyType.replace('_', ' ')}
                        </span>
                      )}
                      {/* Ownership — always present. "Available" signals an
                          unassigned pool slot; a realtor name signals it is
                          spoken for. The broker scans this without touching
                          the assign dropdown. */}
                      <OwnershipBadge member={assignedMember} />
                    </div>
                  </div>

                  {/* Price column — tabular nums, right-aligned, hidden on
                      narrow screens so the row never wraps awkwardly */}
                  <div className="hidden sm:block flex-shrink-0 text-right">
                    {property.listPrice != null ? (
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(property.listPrice)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        No price
                      </p>
                    )}
                  </div>

                  {/* Assign control — compact select, sm+ only. Click is
                      stopped at this div so the row hover does not misread
                      as a navigation intent. */}
                  <div
                    className="hidden sm:block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AssignControl
                      property={property}
                      members={members}
                      onAssigned={handleAssigned}
                    />
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </StaggerList>
      )}
    </div>
  );
}
