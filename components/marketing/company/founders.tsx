'use client';

/**
 * Founders — the two-up section. Orlando and Preston, each a square headshot
 * placeholder (owner swaps real media in), a name, a one-line role, and a
 * short bio. Built from the home kit's vocabulary (Stagger + Placeholder) so
 * it reads as the same family as the rest of the marketing site. No fabricated
 * photo files — the Placeholder is the deliberate "headshot goes here" slot.
 */

import { Stagger, StaggerItem, Placeholder } from '@/components/marketing/home/home-kit';

const FOUNDERS = [
  {
    name: 'Orlando',
    role: 'Co-founder',
    bio: 'Spent a decade in the short-term rental space. He kept running into the same wall: real-estate software and the workflows around it were built for a pre-AI world. The productivity that’s possible now isn’t the productivity agents actually get.',
  },
  {
    name: 'Preston',
    role: 'Co-founder',
    bio: 'A decade building in e-commerce, software, and technology. He recently built groundbreaking AI agent-orchestration frameworks, alongside several products of his own: the machinery that lets an agent do real work, not just answer questions.',
  },
];

export function Founders() {
  return (
    <Stagger className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-16">
      {FOUNDERS.map((f) => (
        <StaggerItem key={f.name}>
          <Placeholder label={f.name} aspect="aspect-square" />
          <h3 className="mt-6 text-[22px] font-semibold tracking-tight text-foreground">
            {f.name}
          </h3>
          <p className="mt-1 text-[13px] font-medium uppercase tracking-[0.16em] text-foreground/45">
            {f.role}
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-foreground/55">
            {f.bio}
          </p>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
