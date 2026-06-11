/**
 * Marketing nav — link data.
 *
 * Single source of truth for the top bar (desktop row + mobile drawer). The
 * site consolidated to a handful of pages, so the old Features/Teams mega
 * menu was retired: the nav is now a flat link row. Add a route here once,
 * it surfaces on both desktop and mobile.
 *
 * Lowercase-noun labels, same product voice.
 */

export interface MarketingPlainLink {
  href: string;
  label: string;
}

/* ─── Top-level nav items (flat) ─────────────────────────────────────── */

export const TOP_LEVEL_NAV: MarketingPlainLink[] = [
  { href: '/realtors', label: 'Realtors' },
  { href: '/brokerages', label: 'Brokerages' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/company', label: 'Company' },
];
