/**
 * `/demo` — book a demo.
 *
 * One focal element: the scheduler. A brokerage or team evaluating Chippi
 * lands here, reads one sentence about what they'll see, and books a time.
 * No second ask competing — just a quiet "start now" line under the calendar.
 *
 * Auth users bounce to their workspace (same pattern as the homepage); a
 * signed-in realtor doesn't need to book a sales walkthrough.
 *
 * Swapping in the real scheduler is ONE line: paste the Calendly inline-embed
 * URL into CALENDLY_URL below. Empty → a calm placeholder renders instead.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { DemoBooking } from '@/components/marketing/demo/demo-booking';

export const metadata = { title: 'Book a demo · Chippi' };

export default async function DemoPage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/auth/redirect?intent=realtor');
  }

  return (
    <div className="bg-background text-foreground">
      <DemoBooking />
    </div>
  );
}
