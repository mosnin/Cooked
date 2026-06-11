/**
 * `/` (home): Chippi homepage, rebuilt on the fortitudo "studio ASCII" design system.
 *
 * One scrolling experience in fortitudo's section vocabulary, carrying Chippi's
 * real-estate-CRM substance: meet the agent (ASCII hero with the rotating job
 * word) → the honest number strip (stats) → the work it handles (gradient
 * cards) → the flow (how it works) → why it exists (about) → the ask (ASCII
 * CTA). Testimonials return when real customer quotes exist — placeholder
 * quotes with invented star ratings don't ship. The shared fortitudo
 * footer/nav come from the route-group layout, so there's no per-page footer.
 *
 * Auth users bounce straight to their workspace (unchanged auth wiring).
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { HomeHero } from '@/components/marketing/fortitudo/home/hero';
import { StatsBand } from '@/components/marketing/fortitudo/home/stats-band';
import { CoreCards } from '@/components/marketing/fortitudo/home/core-cards';
import { HowItWorks } from '@/components/marketing/fortitudo/home/how-it-works';
import { About } from '@/components/marketing/fortitudo/home/about';
import { HomeCTA } from '@/components/marketing/fortitudo/home/cta';

export default async function MarketingHomePage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/auth/redirect?intent=realtor');
  }

  return (
    <div className="bg-background text-foreground">
      <HomeHero />
      <StatsBand />
      <CoreCards />
      <HowItWorks />
      <About />
      <HomeCTA />
    </div>
  );
}
