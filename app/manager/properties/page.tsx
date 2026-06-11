import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import { ManagerPropertiesClient } from './properties-client';

export const metadata: Metadata = { title: 'Properties — Team' };

export default async function ManagerPropertiesPage() {
  const ctx = await resolveManagerContext();
  if (!ctx) redirect('/');

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <ManagerPropertiesClient />
    </div>
  );
}
