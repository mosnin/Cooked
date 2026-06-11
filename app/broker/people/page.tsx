import { redirect } from 'next/navigation';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { BrokerPeopleTable } from './broker-people-table';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'People' };

export default async function BrokerPeoplePage() {
  const ctx = await resolveBrokerContext();
  if (!ctx) redirect('/');

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <BrokerPeopleTable />
    </div>
  );
}
