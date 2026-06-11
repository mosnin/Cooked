'use client';

/**
 * Core cards: fortitudo's services grid rebuilt as the five things Chippi does,
 * each a premium GradientCard (3D tilt, ASCII signature, Chippi-orange glow).
 * Copy is Chippi's real-estate-CRM substance, lifted from the existing home.
 */

import { motion } from 'motion/react';
import { GradientCard } from '../gradient-card';

const cards = [
  {
    title: 'Reads your inbox',
    description:
      'Gmail and Outlook plug in. Chippi reads every inbound, weighs it against your live deals, and quietly lifts the one to look at first.',
    cta: 'See the inbox',
    href: '/realtors#the-inbox',
  },
  {
    title: 'Drafts in your voice',
    description:
      "Every reply written before you open the thread. Read it, edit it, send it. Or don't. Nothing leaves without your tap.",
    cta: 'Meet Chippi',
    href: '/realtors#the-reply',
  },
  {
    title: 'Knows who to call first',
    description:
      'Every lead scored against your deals, the hottest one rising out of the noise, so your morning starts with the right call.',
    cta: 'See scoring',
    href: '/realtors#first-call',
  },
  {
    title: 'Books the tour',
    description:
      'Reply with a time; Chippi checks your calendar, books it, sends the confirmation, and writes it back to the deal.',
    cta: 'See the calendar',
    href: '/realtors#in-the-field',
  },
];

export function CoreCards() {
  return (
    <section id="services" className="relative scroll-mt-24 bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-brand text-xs uppercase tracking-[0.25em] text-brand">What Chippi does</p>
          <h2 className="font-brand mt-3 text-3xl text-foreground sm:text-4xl lg:text-5xl">
            The busywork, <span className="text-gradient-brand">handled.</span>
          </h2>
          <p className="mt-4 text-lg text-foreground/60">
            The work that used to eat your day, done before you ask. You stay in the driver&rsquo;s seat
            on every send.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.08 }}
            >
              <GradientCard
                index={index + 1}
                title={card.title}
                description={card.description}
                href={card.href}
                cta={card.cta}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
