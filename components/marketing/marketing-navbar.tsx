/**
 * Marketing navbar wrapper.
 *
 * The nav is now a pure DOM/framer-motion pill — no Canvas, no WebGL — so the
 * old `ssr: false` dynamic import is gone. The underlying component carries its
 * own 'use client' boundary; the server marketing layout renders this directly.
 */

import { Navbar } from '@/components/ui/3d-interactive-navbar';

export function MarketingNavbar() {
  return <Navbar />;
}
