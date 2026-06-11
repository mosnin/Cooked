import { getBrokerMemberContext } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { cn } from '@/lib/utils';
import TemplatesClient from './templates-client';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Templates — Teams' };

export default async function TemplatesPage() {
  const ctx = await getBrokerMemberContext();
  if (!ctx) redirect('/');

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-56 md:pb-24">
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Templates.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          The team’s playbook
        </h1>
        <p className={cn(BODY_MUTED)}>
          Write a message once. Push the latest to every agent.
        </p>
      </header>

      <TemplatesClient />
    </div>
  );
}
