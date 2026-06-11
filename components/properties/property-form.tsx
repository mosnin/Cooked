'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Property, PropertyListingStatus, PropertyType } from '@/lib/types';
import { PROPERTY_LISTING_STATUS_OPTIONS, PROPERTY_TYPE_OPTIONS } from '@/lib/properties';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PropertyPhotoEditor } from './property-photo-editor';

type FormValues = Partial<Property>;

interface Props {
  initial?: FormValues;
  onCancel: () => void;
  onSubmit: (values: FormValues) => void;
  submitting?: boolean;
  submitLabel?: string;
}

/**
 * Shared property create/edit form. Field set is intentionally small — a
 * realtor adding a property in the middle of their day shouldn't have to
 * fill twenty boxes. Everything except address is optional.
 *
 * All inputs are the canonical <Input> / <Textarea> primitives so the form
 * inherits the product's paper-flat polish (no shadow, 2px focus ring,
 * quieter placeholder, 150ms transitions). The status/type pickers are
 * still native <select> for keyboard-first speed; they're styled with the
 * same chain as Input so the row visually aligns.
 *
 * Photos live at the top — a property is what it looks like, not what its
 * MLS number is. The featured photo is `photos[0]` (convention reused from
 * the list + detail pages); the editor lets the realtor tap any tile to
 * promote it. The first uploaded photo is featured by default.
 */
export function PropertyForm({ initial = {}, onCancel, onSubmit, submitting, submitLabel = 'Save' }: Props) {
  const [v, setV] = useState<FormValues>({
    listingStatus: 'active',
    photos: [],
    ...initial,
  });

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = (v.address ?? '').trim();
    if (!address) return;
    onSubmit({
      address,
      unitNumber: v.unitNumber?.toString().trim() || null,
      city: v.city?.toString().trim() || null,
      stateRegion: v.stateRegion?.toString().trim() || null,
      postalCode: v.postalCode?.toString().trim() || null,
      mlsNumber: v.mlsNumber?.toString().trim() || null,
      listingUrl: v.listingUrl?.toString().trim() || null,
      propertyType: (v.propertyType ?? null) as PropertyType | null,
      listingStatus: (v.listingStatus ?? 'active') as PropertyListingStatus,
      beds: v.beds != null ? Number(v.beds) : null,
      baths: v.baths != null ? Number(v.baths) : null,
      squareFeet: v.squareFeet != null ? Number(v.squareFeet) : null,
      lotSizeSqft: v.lotSizeSqft != null ? Number(v.lotSizeSqft) : null,
      yearBuilt: v.yearBuilt != null ? Number(v.yearBuilt) : null,
      listPrice: v.listPrice != null ? Number(v.listPrice) : null,
      notes: v.notes?.toString() || null,
      photos: Array.isArray(v.photos) ? v.photos : [],
    });
  }

  // Native <select> styled to match <Input> — same height, border, radius,
  // padding, focus ring. Keeps the form a single visual row when the type
  // and status sit next to bed/bath number fields.
  const selectClasses = cn(
    'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base transition-colors duration-150 outline-none md:text-sm',
    'dark:bg-input/30',
    'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Photos first — the realtor is showing a house, not filing an MLS
          form. The featured tile sets what the list, the deal card, and
          the listing detail show. */}
      <Field label="Photos">
        <PropertyPhotoEditor
          value={v.photos ?? []}
          onChange={(next) => set('photos', next)}
        />
      </Field>

      {/* Address row */}
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Field label="Address" required>
          <Input
            type="text"
            required
            value={v.address ?? ''}
            onChange={(e) => set('address', e.target.value)}
            placeholder="123 Main St"
          />
        </Field>
        <Field label="Unit">
          <Input
            type="text"
            value={v.unitNumber ?? ''}
            onChange={(e) => set('unitNumber', e.target.value)}
            placeholder="4B"
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="City">
          <Input type="text" value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="State">
          <Input type="text" value={v.stateRegion ?? ''} onChange={(e) => set('stateRegion', e.target.value)} />
        </Field>
        <Field label="ZIP">
          <Input type="text" value={v.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="MLS #">
          <Input
            type="text"
            value={v.mlsNumber ?? ''}
            onChange={(e) => set('mlsNumber', e.target.value)}
            placeholder="Unique per space"
          />
        </Field>
        <Field label="Listing URL">
          <Input
            type="url"
            value={v.listingUrl ?? ''}
            onChange={(e) => set('listingUrl', e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="Type">
          <select
            value={v.propertyType ?? ''}
            onChange={(e) => set('propertyType', (e.target.value || null) as PropertyType | null)}
            className={selectClasses}
          >
            <option value="">—</option>
            {PROPERTY_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={v.listingStatus ?? 'active'}
            onChange={(e) => set('listingStatus', e.target.value as PropertyListingStatus)}
            className={selectClasses}
          >
            {PROPERTY_LISTING_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Beds">
          <Input
            type="number"
            step="0.5"
            min="0"
            value={v.beds ?? ''}
            onChange={(e) => set('beds', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Baths">
          <Input
            type="number"
            step="0.5"
            min="0"
            value={v.baths ?? ''}
            onChange={(e) => set('baths', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="Sq ft">
          <Input
            type="number"
            min="0"
            value={v.squareFeet ?? ''}
            onChange={(e) => set('squareFeet', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Lot (sqft)">
          <Input
            type="number"
            min="0"
            value={v.lotSizeSqft ?? ''}
            onChange={(e) => set('lotSizeSqft', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Year built">
          <Input
            type="number"
            min="1600"
            max="2200"
            value={v.yearBuilt ?? ''}
            onChange={(e) => set('yearBuilt', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="List price">
          <Input
            type="number"
            min="0"
            step="1000"
            value={v.listPrice ?? ''}
            onChange={(e) => set('listPrice', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="Notes">
        <Textarea
          value={v.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          placeholder="Anything buyers or co-agents should know."
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting || !(v.address ?? '').trim()}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}{required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}
