import { redirect } from 'next/navigation';
import { isPlatformAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { AnnouncementClient, type Announcement } from './announcement-client';

export const metadata = { title: 'Announcements — Admin — Chippi' };

export default async function AdminAnnouncementsPage() {
  const ok = await isPlatformAdmin();
  if (!ok) redirect('/');

  const { data, error } = await supabase
    .from('Announcement')
    .select('*')
    .order('createdAt', { ascending: false })
    .limit(100);

  if (error) throw error;

  const announcements = (data ?? []) as Announcement[];

  return (
    <div className="space-y-8 pb-12">
      <header className="space-y-1.5">
        <p className="text-sm text-muted-foreground">Growth.</p>
        <h1
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          Announcements
        </h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide banners shown to matching users. {announcements.length} total.
        </p>
      </header>
      <AnnouncementClient initialAnnouncements={announcements} />
    </div>
  );
}
