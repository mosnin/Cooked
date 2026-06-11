'use client';

import { useRealtime } from '@/hooks/use-realtime';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { PhoneIncoming, CalendarDays, Briefcase, ArrowRight, CalendarCheck, CalendarX } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import {
  notificationForNewLead,
  notificationForNewDemo,
  notificationForNewDeal,
  notificationForDealStageMove,
  notificationForDemoStatus,
  notificationForLeadScored,
  notificationForLeadScoredHot,
} from '@/lib/notification-voice';

interface Props {
  spaceId: string;
  slug: string;
}

const DEMO_STATUS_ICONS: Record<string, typeof CalendarCheck> = {
  confirmed: CalendarCheck,
  completed: CalendarCheck,
  cancelled: CalendarX,
  no_show:   CalendarX,
};

export function LiveNotifications({ spaceId, slug }: Props) {
  const router = useRouter();

  // Live lead notifications
  useRealtime({
    table: 'Contact',
    event: 'INSERT',
    filter: `spaceId=eq.${spaceId}`,
    onEvent: (payload) => {
      const contact = payload.new as any;
      if (!contact?.name) return;
      if (contact?.teamId) return; // Team intake leads are manager-dashboard only
      toast.success(notificationForNewLead(contact.name), {
        description: contact.phone || contact.email || undefined,
        icon: <PhoneIncoming size={16} />,
        action: {
          label: 'View',
          onClick: () => router.push(`/s/${slug}/contacts/${contact.id}`),
        },
        duration: 8000,
      });
      router.refresh();
    },
  });

  // Live demo bookings
  useRealtime({
    table: 'Demo',
    event: 'INSERT',
    filter: `spaceId=eq.${spaceId}`,
    onEvent: (payload) => {
      const demo = payload.new as any;
      if (!demo?.guestName) return;
      toast.success(notificationForNewDemo(demo.guestName, demo.propertyAddress), {
        icon: <CalendarDays size={16} />,
        action: {
          label: 'View',
          onClick: () => router.push(`/s/${slug}/calendar`),
        },
        duration: 8000,
      });
      router.refresh();
    },
  });

  // Live deal updates
  useRealtime({
    table: 'Deal',
    event: 'INSERT',
    filter: `spaceId=eq.${spaceId}`,
    onEvent: (payload) => {
      const deal = payload.new as any;
      if (!deal?.title) return;
      toast.success(notificationForNewDeal(deal.title, deal.address), {
        icon: <Briefcase size={16} />,
        duration: 6000,
      });
      router.refresh();
    },
  });

  // Stage moves — fires when a Deal's stageId changes (drag, manual, or
  // Koala via advance_deal_stage). Resolves the stage name lazily so the
  // toast can name the destination instead of just saying "moved".
  useRealtime({
    table: 'Deal',
    event: 'UPDATE',
    filter: `spaceId=eq.${spaceId}`,
    onEvent: async (payload) => {
      const oldDeal = payload.old as any;
      const newDeal = payload.new as any;
      if (!newDeal?.title) return;
      if (oldDeal?.stageId === newDeal?.stageId) return;
      if (!newDeal?.stageId) return;

      let stageName: string | null = null;
      try {
        const sb = getSupabaseBrowser();
        if (sb) {
          const { data } = await sb
            .from('DealStage')
            .select('name')
            .eq('id', newDeal.stageId)
            .maybeSingle<{ name: string | null }>();
          stageName = data?.name ?? null;
        }
      } catch {
        // Stage lookup is best-effort. Toast still fires below.
      }

      toast.success(
        notificationForDealStageMove(newDeal.title, stageName ?? 'the next stage'),
        {
          icon: <ArrowRight size={16} />,
          duration: 5000,
          action: {
            label: 'Open',
            onClick: () => router.push(`/s/${slug}/deals`),
          },
        },
      );
      router.refresh();
    },
  });

  // Demo status changes — confirmed, completed, cancelled, no_show.
  useRealtime({
    table: 'Demo',
    event: 'UPDATE',
    filter: `spaceId=eq.${spaceId}`,
    onEvent: (payload) => {
      const oldDemo = payload.old as any;
      const newDemo = payload.new as any;
      if (!newDemo?.guestName) return;
      if (oldDemo?.status === newDemo?.status) return;

      const status = newDemo.status as 'confirmed' | 'completed' | 'cancelled' | 'no_show';
      const Icon = DEMO_STATUS_ICONS[status];
      if (!Icon) return;

      const fn = status === 'cancelled' || status === 'no_show'
        ? toast.warning
        : toast.success;

      const copy = notificationForDemoStatus(newDemo.guestName, status, newDemo.propertyAddress);
      fn(copy.title, {
        description: copy.description || undefined,
        icon: <Icon size={16} />,
        duration: 6000,
        action: {
          label: 'Open',
          onClick: () => router.push(`/s/${slug}/calendar`),
        },
      });
      router.refresh();
    },
  });

  // Scoring updates - when a contact's scoring status changes
  useRealtime({
    table: 'Contact',
    event: 'UPDATE',
    filter: `spaceId=eq.${spaceId}`,
    onEvent: (payload) => {
      const oldRecord = payload.old as any;
      const newRecord = payload.new as any;
      if (newRecord?.teamId) return; // Team intake leads are manager-dashboard only
      // Only notify when scoring completes
      if (oldRecord?.scoringStatus === 'pending' && newRecord?.scoringStatus === 'scored' && newRecord?.scoreLabel) {
        const name = newRecord.name || 'A new contact';
        const label = String(newRecord.scoreLabel).toLowerCase();
        // Hot crossings get the urgency line; the rest just state the tier.
        if (label === 'hot') {
          toast.info(notificationForLeadScoredHot(name), { duration: 6000 });
        } else {
          const copy = notificationForLeadScored(name, newRecord.scoreLabel, newRecord.leadScore);
          toast.info(copy.title, { description: copy.description, duration: 6000 });
        }
        router.refresh();
      }
    },
  });

  return null; // This component renders nothing — it just subscribes
}
