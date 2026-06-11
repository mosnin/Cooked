/**
 * Default OG image for every marketing route.
 *
 * Next.js's `opengraph-image.tsx` convention: this file lives inside the
 * `(marketing)` route group and becomes the `og:image` for every page
 * under it that doesn't define its own. Pages with their own messaging
 * (pricing, about, the feature surfaces) can override by dropping their
 * own `opengraph-image.tsx` in their directory.
 *
 * Design: Apple-paper-flat. White background, serif title centered, the
 * Chippi wordmark top-left, the domain bottom-left. No gradient, no
 * shadow, no decoration. The OG image carries the same brand discipline
 * as the page it represents.
 *
 * Fonts: bundled Tinos (Times-compatible OFL serif) + Inter (OFL sans)
 * fetched once at edge runtime. We don't use system fonts because Satori
 * won't render them — the OG must look identical wherever it's previewed.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Chippi · Agentic OS for real estate';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

async function loadFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font: ${url}`);
  return res.arrayBuffer();
}

export default async function Image() {
  const [serif, sans] = await Promise.all([
    loadFont(
      'https://cdn.jsdelivr.net/fontsource/fonts/tinos@latest/latin-400-normal.ttf',
    ),
    loadFont(
      'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf',
    ),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          padding: 80,
          justifyContent: 'space-between',
        }}
      >
        {/* Top row: Chippi wordmark in serif. Tiny — the visual is the title. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span
            style={{
              fontFamily: 'Tinos',
              fontSize: 28,
              color: '#0c0c0d',
              letterSpacing: '-0.01em',
            }}
          >
            Chippi.
          </span>
        </div>

        {/* Center: eyebrow → title → sub. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <span
            style={{
              fontFamily: 'Inter',
              fontSize: 18,
              color: '#6b6f76',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
            }}
          >
            The agentic OS for real estate
          </span>
          <span
            style={{
              fontFamily: 'Tinos',
              fontSize: 96,
              color: '#0c0c0d',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
            }}
          >
            Chippi runs your workspace.
          </span>
          <span
            style={{
              fontFamily: 'Inter',
              fontSize: 32,
              color: '#6b6f76',
              lineHeight: 1.3,
              maxWidth: 900,
            }}
          >
            An AI agent that qualifies leads, drafts follow-ups, schedules tours,
            and keeps your pipeline current.
          </span>
        </div>

        {/* Bottom row: domain left, quiet CTA right. Both small-caps. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <span
            style={{
              fontFamily: 'Inter',
              fontSize: 16,
              color: '#6b6f76',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
            }}
          >
            chippi.app
          </span>
          <span
            style={{
              fontFamily: 'Inter',
              fontSize: 16,
              color: '#6b6f76',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
            }}
          >
            Start free trial
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Tinos', data: serif, style: 'normal', weight: 400 },
        { name: 'Inter', data: sans, style: 'normal', weight: 400 },
      ],
    },
  );
}
