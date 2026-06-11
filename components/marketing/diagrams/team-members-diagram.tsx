'use client';

/**
 * `<TeamMembersDiagram />` — the floor, filling in.
 *
 * One beat: a members table (avatar initials + name + role pill +
 * last-active). A new member fades in at the bottom, role pill defaulting
 * to "Member". The story in one breath: invite → they're on the floor.
 *
 * Role pills are NEUTRAL (hairline/muted), exactly the real product's
 * vocabulary (`members-client.tsx` → `bg-muted text-muted-foreground`).
 * Role is a label, not a status — no tone tints, no brand orange anywhere.
 *
 * Motion contract:
 *   - ~6.6s cycle.
 *   - 1.8s hold on the three seated members.
 *   - New row (Tom Reyes · Member · just now) fades + 6px-rises in, 240ms
 *     EASE_APPLE.
 *   - 3.4s hold on the four-row floor.
 *   - Row fades back out, 700ms pause, restart.
 *
 * Fit: at wide/21:9 a 4-row table is tight — rows are flex-1 distributed
 * and the last-active column hides below `md` so the four rows never
 * overflow the short box.
 *
 * Reduced-motion: render the END state — Tom Reyes already seated.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  ChippiDiagramShell,
  useDiagramMotion,
} from './chippi-diagram-shell';

interface TeamMembersDiagramProps {
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  className?: string;
}

type Role = 'Owner' | 'Admin' | 'Member';

interface MemberRow {
  id: string;
  name: string;
  initials: string;
  role: Role;
  lastActive: string;
}

// The three seated members. Tom is the one who fades in.
const SEATED: MemberRow[] = [
  { id: 'maya', name: 'Maya Okafor', initials: 'MO', role: 'Owner', lastActive: 'now' },
  { id: 'devin', name: 'Devin Brooks', initials: 'DB', role: 'Admin', lastActive: '2m' },
  { id: 'priya', name: 'Priya Nair', initials: 'PN', role: 'Member', lastActive: '14m' },
];

const NEW_MEMBER: MemberRow = {
  id: 'tom',
  name: 'Tom Reyes',
  initials: 'TR',
  role: 'Member',
  lastActive: 'just now',
};

const ROW_IN_AT = 1800;
const ROW_OUT_AT = 5200;
const CYCLE_TOTAL = 5900;

// Role pill — neutral, hairline-muted. Mirrors `members-client.tsx` exactly:
// role is a label, not a status, so no tone tints.
function RolePill({ role }: { role: Role }) {
  return (
    <span className="inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 bg-muted text-muted-foreground whitespace-nowrap">
      {role}
    </span>
  );
}

function MemberRowItem({ row }: { row: MemberRow }) {
  return (
    <li className="flex-1 min-h-0 flex items-center gap-2.5 px-1">
      {/* Avatar — initials, neutral fill. Same as the product members row. */}
      <div className="w-7 h-7 rounded-full bg-foreground/[0.06] text-foreground/80 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
        {row.initials}
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <span className="text-[13px] font-medium text-foreground truncate">
          {row.name}
        </span>
        <RolePill role={row.role} />
      </div>
      {/* Last-active — meta, tabular. Hidden on short/narrow boxes so the
          four rows fit the 21:9 aspect without overflow. */}
      <span className="hidden md:block text-[11px] tabular-nums text-muted-foreground flex-shrink-0">
        {row.lastActive}
      </span>
    </li>
  );
}

export function TeamMembersDiagram({
  aspect = 'video',
  className,
}: TeamMembersDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={6} className={className}>
      <TeamMembersContent />
    </ChippiDiagramShell>
  );
}

function TeamMembersContent() {
  const { reduced } = useDiagramMotion();
  // false = three seated, true = Tom has joined.
  const [joined, setJoined] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runCycle() {
      timers.push(setTimeout(() => !cancelled && setJoined(true), ROW_IN_AT));
      timers.push(setTimeout(() => !cancelled && setJoined(false), ROW_OUT_AT));
      timers.push(setTimeout(() => !cancelled && runCycle(), CYCLE_TOTAL));
    }
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Quiet header — the status-sentence vocabulary, condensed. */}
      <div className="pb-2.5 flex-shrink-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Members
        </p>
        <p
          className="mt-1 text-[18px] tracking-tight text-foreground leading-snug"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          Who&apos;s on the team
        </p>
      </div>

      {/* Column headers — hairline rule under, like the product table. The
          last-active header hides with its column on short boxes. */}
      <div className="flex items-center gap-2.5 px-1 pb-1.5 border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
        <span className="w-7 flex-shrink-0" aria-hidden />
        <span className="flex-1">Member</span>
        <span className="hidden md:block flex-shrink-0">Last active</span>
      </div>

      {/* Rows — flex-1 distributed so they fill the box and never overflow.
          min-h-0 lets them compress on the short 21:9 aspect. */}
      <ul className="flex-1 flex flex-col divide-y divide-border/60 min-h-0">
        {SEATED.map((m) => (
          <MemberRowItem key={m.id} row={m} />
        ))}

        {/* The new member — fades + rises in. Kept mounted as a flex-1 row so
            the seated rows hold their height; it only animates opacity/y. */}
        <motion.li
          initial={false}
          animate={
            joined
              ? { opacity: 1, y: 0 }
              : { opacity: 0, y: 6 }
          }
          transition={{ duration: 0.24, ease: EASE_APPLE }}
          className="flex-1 min-h-0 flex items-center gap-2.5 px-1"
        >
          <div className="w-7 h-7 rounded-full bg-foreground/[0.06] text-foreground/80 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
            {NEW_MEMBER.initials}
          </div>
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground truncate">
              {NEW_MEMBER.name}
            </span>
            <RolePill role={NEW_MEMBER.role} />
          </div>
          <span className="hidden md:block text-[11px] tabular-nums text-muted-foreground flex-shrink-0">
            {NEW_MEMBER.lastActive}
          </span>
        </motion.li>
      </ul>
    </div>
  );
}
