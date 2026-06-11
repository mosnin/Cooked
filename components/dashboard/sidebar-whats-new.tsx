'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { SECTION_LABEL } from '@/lib/typography';

// ─────────────────────────────────────────────────────────────────────────────
// SidebarWhatsNew — quiet bordered card in the sidebar's bottom slot. v1 has
// one hard-coded message; the localStorage key is suffixed with a `v1` so
// future releases that bump the version re-show the card.
//
// Storage shape: `chippi:sidebar:whatsnew:dismissed:v1` → `'true'`.
//
// Reads on mount; renders nothing during SSR + the first paint to avoid a
// flash for users who have dismissed.
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_VERSION = 'v1';
const STORAGE_KEY = `chippi:sidebar:whatsnew:dismissed:${CURRENT_VERSION}`;

interface SidebarWhatsNewProps {
  /** Hide entirely (collapsed rail mode). */
  collapsed?: boolean;
}

export function SidebarWhatsNew({ collapsed = false }: SidebarWhatsNewProps) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      setDismissed(v === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  function handleDismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore — at least dismisses for this tab
    }
    setDismissed(true);
  }

  // Don't render in the rail OR before hydration, OR after dismissal.
  if (collapsed || dismissed === null || dismissed) return null;

  return (
    <div className="px-3 pb-2">
      <div className="relative rounded-xl border border-border/70 bg-card px-3 py-3">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="absolute top-1.5 right-1.5 w-5 h-5 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
        >
          <X size={11} strokeWidth={1.75} />
        </button>
        <p className={`${SECTION_LABEL} pb-1`}>What&apos;s new</p>
        <p className="text-[12px] text-foreground/85 leading-snug pr-4">
          Email + Calendar mirror is live.
        </p>
        <Link
          href="/changelog"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          See changes
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
