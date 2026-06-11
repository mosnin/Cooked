import type { MetadataRoute } from 'next';

/**
 * Marketing-site base URL. Prefer NEXT_PUBLIC_SITE_URL; fall back to the
 * production marketing host. Public root (usechippi.com), not the app
 * subdomain.
 */
const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usechippi.com'
).replace(/\/$/, '');

type ChangeFrequency = NonNullable<
  MetadataRoute.Sitemap[number]['changeFrequency']
>;

/**
 * Public marketing routes only — mirrors the page tree under
 * `app/(marketing)/**`. Authenticated (`/s`, `/broker`), setup, auth,
 * billing, and API routes are intentionally excluded (see robots.ts).
 */
const ROUTES: ReadonlyArray<{
  path: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}> = [
  // Core marketing pages
  { path: '/', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/realtors', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/brokerages', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/integrations', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/company', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/demo', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/status', changeFrequency: 'daily', priority: 0.4 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
