import { redirect } from 'next/navigation';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import { ManagerPeopleTable } from './manager-people-table';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'People' };

export default async function ManagerPeoplePage() {
  const ctx = await resolveManagerContext();
  if (!ctx) redirect('/');

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <ManagerPeopleTable />
    </div>
  );
}
