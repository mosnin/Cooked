import type { MetadataRoute } from 'next';

/**
 * Marketing-site base URL. Prefer NEXT_PUBLIC_SITE_URL; fall back to the
 * production marketing host. Note this is the public root (usekoala.com),
 * NOT the app subdomain (my.usekoala.com) used by NEXT_PUBLIC_APP_URL.
 */
const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usekoala.com'
).replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/s/',
        '/manager/',
        '/setup',
        '/login',
        '/subscribe',
        '/billing',
      ],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
