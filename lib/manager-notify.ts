/**
 * Helper to create manager notifications.
 * Non-blocking — failures are logged but never throw.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export type ManagerNotificationType =
  | 'member_joined'
  | 'member_removed'
  | 'deal_won'
  | 'deal_created'
  | 'lead_hot'
  | 'review_requested';

export interface NotifyManagerParams {
  teamId: string;
  type: ManagerNotificationType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export async function notifyManager(params: NotifyManagerParams): Promise<void> {
  const { teamId, type, title, body, metadata } = params;

  try {
    await supabase.from('ManagerNotification').insert({
      id: crypto.randomUUID(),
      teamId,
      type,
      title,
      body: body ?? null,
      metadata: metadata ?? null,
      read: false,
    });
  } catch (err) {
    logger.error('[manager-notify] failed to create notification', { type, teamId }, err);
  }
}
