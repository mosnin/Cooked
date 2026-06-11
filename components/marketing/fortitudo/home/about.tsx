'use client';

/** About: fortitudo's two-column belief section, carrying Chippi's conviction
 *  (lifted from the /company beliefs). */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { SpotlightCard } from '../spotlight-card';

const values = [
  {
    title: 'Nothing leaves without your name on it',
    description:
      'Chippi drafts, books, and updates, but by default every move is yours to approve. The default is you in the loop, and that is where the trust lives.',
  },
  {
    title: 'One workspace, not six tools',
    description:
      'CRM, inbox, calendar, content studio, files, and the team dashboard. One agent runs all of it, and they finally agree.',
  },
  {
    title: 'Configuration is failure to decide',
    description:
      'No settings maze, no tiers, no toggles to operate. We pick, so your day gets simpler instead of harder.',
  },
];

export function About() {
  return (
    <section id="about" className="relative scroll-mt-24 bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="font-brand text-xs uppercase tracking-[0.25em] text-brand">Why Chippi</p>
            <h2 className="font-brand mt-3 text-3xl text-foreground sm:text-4xl lg:text-5xl">
              Real estate, working the way the rest of the world{' '}
              <span className="text-gradient-brand">already does.</span>
            </h2>
            <p className="mt-5 text-lg text-foreground/65">
              The tools agents and brokerages live in were drawn for a slower era. The work
              should not be the chrome. The work should be the deals.
            </p>
            <p className="mt-4 text-foreground/55">
              Chippi is the extra teammate who handles the repetitive work, so the hours go to
              closing, and you stay in the driver&rsquo;s seat on every send.
            </p>
            <Link
              href="/company"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition-all hover:brightness-105"
            >
              Read our story
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="space-y-4">
            {values.map((value, index) => (
              <motion.div
                key={value.title}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
              >
                <SpotlightCard className="p-6">
                  <h3 className="font-brand text-lg text-foreground">{value.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {value.description}
                  </p>
                </SpotlightCard>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
