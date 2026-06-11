/**
 * `cancel_demo` — flip a Demo to status='cancelled'.
 *
 * Approval-gated: a cancelled demo drops off the calendar feed and
 * triggers (via cron) the cancel email — worth the rep confirming.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { deleteGoogleEvent } from '@/lib/gcal-helpers';
import { defineTool } from '../types';

const parameters = z
  .object({
    demoId: z.string().min(1).describe('The Demo.id to cancel.'),
    reason: z.string().min(1).max(500).describe('Why the demo is being cancelled (logged on the contact activity feed).'),
  })
  .describe('Cancel a demo and log the reason.');

interface CancelDemoResult {
  demoId: string;
  status: 'cancelled';
}

export const cancelDemoTool = defineTool<typeof parameters, CancelDemoResult>({
  name: 'cancel_demo',
  riskLevel: 'destructive',
  description:
    'Cancel a demo. Records the reason on the linked contact. Prompts for approval first.',
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    return `Cancel demo ${args.demoId.slice(0, 8)} — ${args.reason}`;
  },

  async handler(args, ctx) {
    const { data: demo, error: demoErr } = await supabase
      .from('Demo')
      .select('id, contactId, guestName, propertyAddress, status, googleEventId')
      .eq('id', args.demoId)
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    if (demoErr) {
      return { summary: `Demo lookup failed: ${demoErr.message}`, display: 'error' };
    }
    if (!demo) {
      return { summary: `No demo with that id.`, display: 'error' };
    }
    if (demo.status === 'cancelled') {
      return {
        summary: `That demo is already cancelled.`,
        data: { demoId: args.demoId, status: 'cancelled' as const },
        display: 'plain',
      };
    }

    const { error: updateErr } = await supabase
      .from('Demo')
      .update({ status: 'cancelled', updatedAt: new Date().toISOString() })
      .eq('id', args.demoId)
      .eq('spaceId', ctx.space.id);
    if (updateErr) {
      logger.error('[tools.cancel_demo] update failed', { demoId: args.demoId }, updateErr);
      return { summary: `Cancel failed: ${updateErr.message}`, display: 'error' };
    }

    // Drop the mirrored Google Calendar event — the /api/demos/[id] PATCH
    // route does this on status=cancelled; the tool path must match or the
    // rep's GCal keeps a ghost slot. Fire-and-forget: DB has committed,
    // a GCal hiccup orphans the event and gcal-helpers logs it for ops.
    const googleEventId = (demo as { googleEventId?: string | null }).googleEventId;
    if (googleEventId) {
      void deleteGoogleEvent({ spaceId: ctx.space.id, googleEventId }).then(async (ok) => {
        if (ok) {
          // Clear the stale id so a future sync doesn't try to update a
          // deleted event.
          await supabase
            .from('Demo')
            .update({ googleEventId: null })
            .eq('id', args.demoId)
            .eq('spaceId', ctx.space.id);
        }
      });
    }

    if (demo.contactId) {
      const { error: activityErr } = await supabase.from('ContactActivity').insert({
        id: crypto.randomUUID(),
        spaceId: ctx.space.id,
        contactId: demo.contactId,
        type: 'note',
        content: `Demo cancelled: ${args.reason}`,
        metadata: { demoId: args.demoId, via: 'on_demand_agent' },
      });
      if (activityErr) {
        logger.warn('[tools.cancel_demo] activity insert failed', { demoId: args.demoId }, activityErr);
      }
    }

    const guest = (demo.guestName as string | null) || 'guest';
    return {
      summary: `Demo for ${guest} cancelled.`,
      data: { demoId: args.demoId, status: 'cancelled' as const },
      display: 'success',
    };
  },
});
