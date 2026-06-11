import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { BrokerPropertiesClient } from './properties-client';

export const metadata: Metadata = { title: 'Properties — Brokerage' };

export default async function BrokerPropertiesPage() {
  const ctx = await resolveBrokerContext();
  if (!ctx) redirect('/');

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <BrokerPropertiesClient />
    </div>
  );
}
