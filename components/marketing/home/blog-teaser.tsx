'use client';

/**
 * BlogTeaser — a quiet "from the team" row near the foot of the page. Three
 * cards, placeholder cover + title + meta, scroll-staggered. Links are
 * placeholders until the blog ships.
 */

import Link from 'next/link';
import { Reveal, Stagger, StaggerItem, Eyebrow } from './home-kit';
import { ArrowRight } from 'lucide-react';
import { MediaSlot } from './media-slot';

const POSTS = [
  { tag: 'Product', title: 'Why an agent beats another CRM tab.', read: '5 min read' },
  { tag: 'Playbook', title: 'The first hour: triaging leads with Chippi.', read: '4 min read' },
  { tag: 'Brokerage', title: 'Running a floor without nagging for updates.', read: '6 min read' },
];

export function BlogTeaser() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <Reveal className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <Eyebrow>From the team</Eyebrow>
          <h2 className="mt-5 font-title text-[clamp(2rem,4.5vw,3.5rem)] font-normal leading-[1.04] tracking-[-0.018em] text-foreground">
            Thinking on the business of real estate.
          </h2>
        </div>
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-[15px] font-medium text-foreground transition-colors hover:text-brand"
        >
          Read the blog <ArrowRight size={16} />
        </Link>
      </Reveal>

      <Stagger className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
        {POSTS.map((p) => (
          <StaggerItem key={p.title}>
            <Link href="/blog" className="group block">
              <div className="overflow-hidden rounded-3xl ring-1 ring-border/60">
                <MediaSlot className="aspect-[16/10] w-full" />
              </div>
              <div className="mt-5">
                <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-brand">
                  {p.tag}
                </span>
                <h3 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-brand">
                  {p.title}
                </h3>
                <p className="mt-2 text-[13px] text-foreground/45">{p.read}</p>
              </div>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
