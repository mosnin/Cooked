'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Link2,
  Copy,
  Check,
  ArrowUpRight,
  ClipboardList,
  CalendarDays,
  UserCircle,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SECTION_LABEL } from '@/lib/typography';

interface ShareLinksMenuProps {
  slug: string;
}

interface LinkRowProps {
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  label: string;
  description: string;
  url: string;
  previewHref: string;
}

// One link = one tappable row. Tapping the row copies the URL; the trailing
// icon flips to a check for confirmation. A quiet open-in-new-tab sits to the
// right as a secondary touch. No chips, no outlined buttons — paper-flat rows
// that match sidebar-user-menu's vocabulary.
function LinkRow({ icon: Icon, label, description, url, previewHref }: LinkRowProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // No-op — clipboard rejected. Surfacing an error here would be louder
      // than the failure deserves; the user can still use the preview link.
    }
  };

  const displayUrl = url.replace(/^https?:\/\//, '');

  return (
    <div className="group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-foreground/[0.05]">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()} link`}
        className="flex flex-1 min-w-0 items-center gap-2.5 text-left active:scale-[0.99] transition-transform duration-150"
      >
        <Icon
          size={15}
          strokeWidth={1.75}
          className="flex-shrink-0 text-foreground/55"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium leading-tight text-foreground">
            {label}
          </span>
          <span
            className={cn(
              'block truncate text-[11px] leading-tight mt-0.5 transition-colors duration-150',
              copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/80',
            )}
          >
            {copied ? 'Copied to clipboard' : description}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            'flex-shrink-0 transition-colors duration-150',
            copied
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground/40 group-hover:text-muted-foreground',
          )}
        >
          {copied ? (
            <Check size={14} strokeWidth={2.25} />
          ) : (
            <Copy size={14} strokeWidth={1.75} />
          )}
        </span>
      </button>
      <a
        href={previewHref}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${label.toLowerCase()} in new tab`}
        title={displayUrl}
        className="flex-shrink-0 -mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <ArrowUpRight size={14} strokeWidth={1.75} />
      </a>
    </div>
  );
}

export function ShareLinksMenu({ slug }: ShareLinksMenuProps) {
  // Compose absolute URLs only after mount so the value matches the actual
  // host the realtor is on. Avoids SSR/CSR text mismatch and works on dev,
  // staging, and prod without env-var threading into client components.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  // The realtor's three shareable surfaces. Public profile (the "link in bio"
  // at /p/[slug]) leads — it's the personal link they put everywhere.
  const profilePath = `/p/${slug}`;
  const intakePath = `/apply/${slug}`;
  const bookingPath = `/book/${slug}`;
  const profileUrl = origin ? `${origin}${profilePath}` : profilePath;
  const intakeUrl = origin ? `${origin}${intakePath}` : intakePath;
  const bookingUrl = origin ? `${origin}${bookingPath}` : bookingPath;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Share my links"
          title="Share my links"
          className="h-8 w-8 flex items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors data-[state=open]:bg-foreground/[0.045] data-[state=open]:text-foreground"
        >
          <Link2 size={14} strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-1.5 rounded-xl border border-border/70"
      >
        <div className="px-2 pt-1.5 pb-1">
          <p className={cn(SECTION_LABEL)}>Your links</p>
        </div>

        <LinkRow
          icon={UserCircle}
          label="Public profile"
          description="Your link-in-bio page"
          url={profileUrl}
          previewHref={profilePath}
        />

        <div className="mx-2 my-0.5 h-px bg-border/60" />

        <LinkRow
          icon={ClipboardList}
          label="Application form"
          description="Where new leads apply"
          url={intakeUrl}
          previewHref={intakePath}
        />

        <div className="mx-2 my-0.5 h-px bg-border/60" />

        <LinkRow
          icon={CalendarDays}
          label="Tour booking"
          description="Where prospects book a tour"
          url={bookingUrl}
          previewHref={bookingPath}
        />
      </PopoverContent>
    </Popover>
  );
}
