'use client';

/** Stats band: fortitudo's quiet number strip on a hairline-bounded band.
 *  Honest, product-truth framing (no invented adoption metrics). */

import { motion } from 'motion/react';

const stats = [
  { value: '24/7', label: 'Works the inbox while you sleep' },
  { value: '< 1 min', label: 'Median first touch on a new lead' },
  { value: '6 → 1', label: 'Tools replaced by one workspace' },
  { value: '7 days', label: 'Free trial. Cancel anytime' },
];

export function StatsBand() {
  return (
    <section className="border-y border-border/60 bg-background py-14">
      <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-14 gap-y-8 px-4 sm:gap-x-20">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: index * 0.08 }}
            className="text-center"
          >
            <p className="font-brand text-3xl text-foreground sm:text-4xl">{stat.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
