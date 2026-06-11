'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * EmbedDetector — flips the dashboard shell into "chrome-stripped" mode
 * when the page is loaded inside the Chippi RightPanel iframe.
 *
 * Reads `?embed=1` from the URL and sets `data-chippi-embed="true"` on
 * `document.documentElement`. CSS rules in `app/globals.css` then hide:
 *   - the dashboard sidebar (`[data-dashboard-sidebar]`)
 *   - the dashboard header (`[data-dashboard-header]`)
 *   - the persistent ChippiBar (`[data-page-chat-input]`)
 *   - the mobile nav and platform banner (`[data-dashboard-mobile-nav]`,
 *     `[data-platform-banner]`)
 *
 * The outer Chippi page already owns the sidebar, header, and chat input
 * for its workspace, so the iframe should render only the page content.
 *
 * Normal page visits (no `?embed=1`) are entirely unaffected — the
 * attribute is never set, so none of the CSS rules match.
 */
export function EmbedDetector() {
  const searchParams = useSearchParams();
  const isEmbed = searchParams?.get('embed') === '1';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (isEmbed) {
      root.setAttribute('data-chippi-embed', 'true');
    } else {
      root.removeAttribute('data-chippi-embed');
    }
    return () => {
      root.removeAttribute('data-chippi-embed');
    };
  }, [isEmbed]);

  return null;
}
