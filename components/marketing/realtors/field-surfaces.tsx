'use client';

/**
 * FieldSurfaces — the "reach Chippi wherever the work is" row for /realtors.
 *
 * Three calm cards — phone, the installed web app, the office desktop — each a
 * paper-flat surface in the home-page vocabulary (hairline ring, no shadow,
 * one icon, one line). The idea: a solo realtor is rarely at a desk; Chippi is
 * a tap away on whatever screen is already in their hand.
 *
 * Composes the home kit (Stagger / StaggerItem) so the entrance beat matches
 * every other section on the page.
 */

import { Smartphone, Globe, Monitor } from 'lucide-react';
import { Stagger, StaggerItem } from '@/components/marketing/home/home-kit';

const SURFACES = [
  {
    icon: Smartphone,
    title: 'on your phone.',
    body: 'talk to Chippi between showings. read the thread, approve the draft, book the tour without sitting down.',
  },
  {
    icon: Globe,
    title: 'in the web app.',
    body: 'install Chippi to your home screen. the whole workspace, no app store, online or driving between doors.',
  },
  {
    icon: Monitor,
    title: 'at the office.',
    body: 'back at the desk, the same workspace opens wide: inbox, pipeline, and calendar where you left them.',
  },
];

export function FieldSurfaces() {
  return (
    <Stagger className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/60 md:grid-cols-3">
      {SURFACES.map((s) => {
        const Icon = s.icon;
        return (
          <StaggerItem key={s.title} className="bg-card">
            <div className="flex h-full flex-col gap-4 p-8">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/70">
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <h3 className="font-title text-[1.6rem] font-normal leading-[1.05] tracking-[-0.02em] text-foreground">
                {s.title}
              </h3>
              <p className="text-[15px] leading-relaxed text-foreground/55">
                {s.body}
              </p>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
