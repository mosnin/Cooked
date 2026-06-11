'use client';

/**
 * Light/dark toggle for the marketing chrome. Flips the shared ThemeProvider
 * (sets localStorage 'theme' + the `.dark` class), so the nav and every
 * token-driven element on the site switch together. Mount-guarded so the icon
 * doesn't flash the wrong state during hydration.
 */

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

export function MarketingThemeToggle({
  className,
  onMouseEnter,
}: {
  className?: string;
  onMouseEnter?: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      onMouseEnter={onMouseEnter}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full',
        'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.05]',
        'transition-colors duration-150',
        className,
      )}
    >
      {isDark ? (
        <Sun size={17} strokeWidth={1.75} />
      ) : (
        <Moon size={17} strokeWidth={1.75} />
      )}
    </button>
  );
}
