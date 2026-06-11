/**
 * Shared listing-status pill for a Property.
 *
 * Listing status (active / pending / sold / off_market / owned) is metadata,
 * not signal. The stylesheet's tone palette (amber/emerald/rose) is reserved
 * for "you owe action" cues — review states, follow-up timing, agent output.
 * A property being "Active" doesn't ask the realtor to do anything; it's just
 * a fact. So this badge is intentionally muted: a single neutral pill with
 * a small icon, the same vocabulary on every surface it appears.
 *
 * Used by:
 *   - app/s/[slug]/properties/page.tsx           (the property list)
 *   - components/properties/property-detail-client.tsx  (detail page header)
 *   - components/deals/deal-property-picker.tsx  (linked-property row)
 */
import { CircleDot, Clock, Check, Archive, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROPERTY_LISTING_STATUS_OPTIONS } from '@/lib/properties';
import type { PropertyListingStatus } from '@/lib/types';

interface Props {
  status: PropertyListingStatus;
  className?: string;
}

function iconFor(status: PropertyListingStatus) {
  switch (status) {
    case 'active':     return CircleDot;
    case 'pending':    return Clock;
    case 'sold':       return Check;
    case 'owned':      return Archive;
    case 'off_market': return EyeOff;
    default:           return CircleDot;
  }
}

function labelFor(status: PropertyListingStatus): string {
  return PROPERTY_LISTING_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function PropertyStatusBadge({ status, className }: Props) {
  const Icon = iconFor(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        'text-[11px] font-medium',
        'bg-muted text-muted-foreground',
        className,
      )}
    >
      <Icon size={11} aria-hidden />
      {labelFor(status)}
    </span>
  );
}
