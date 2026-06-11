'use client';

import { motion, type Variants } from 'framer-motion';
import { usePathname } from 'next/navigation';

/**
 * Wraps page children with a 180ms opacity fade on route change.
 * Mounts inside the workspace `<main>` so the chrome (header / sidebar)
 * doesn't re-animate on every nav.
 *
 * The curve is the Apple ease-out `[0.22, 1, 0.36, 1]` — same one used by
 * Dialog/Popover/DropdownMenu/Sheet so chrome motion feels like one system.
 * Pure opacity, no y-translate: the page should feel like it _resolved_,
 * not like it slid in. `MotionConfig reducedMotion="user"` in the root
 * layout already short-circuits this for users who opt out.
 *
 * Accepts an optional className so callers can give the wrapper flex
 * sizing — needed on the Chippi chat route where the page must fill
 * the parent flex column for the composer's bottom-pin to work.
 */
const ROUTE_FADE: Variants = {
  initial: { opacity: 0 },
  enter: {
    opacity: 1,
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.12, ease: [0.22, 1, 0.36, 1] },
  },
};

export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      variants={ROUTE_FADE}
      initial="initial"
      animate="enter"
      exit="exit"
      className={className}
    >
      {children}
    </motion.div>
  );
}
