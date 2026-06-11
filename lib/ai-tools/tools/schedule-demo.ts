/**
 * `schedule_demo` — create a Demo row + mirror to the rep's external
 * calendar.
 *
 * Approval-gated: the demo lands on the rep's actual calendar (Google,
 * Outlook), and a misclicked time/address is annoying to unwind. The user
 * sees the full prompt (guest, property, start/end) before we commit.
 *
 * Write order after approval:
 *   1. Insert Demo row (idempotent booking primitive — manage tokens,
 *      conflict checks, source attribution).
 *   2. Write through to the connected external calendar via Composio
 *      (`GOOGLECALENDAR_CREATE_EVENT`) AND log a CalendarEventMirror
 *      row. The mirror row is the backup; the external calendar is the
 *      source of truth. If the external write fails, the mirror row
 *      still lands so we don't lose the intent.
 *
 * Either `contactId` (preferred, links to a saved Contact) or
 * `guestName` + `guestEmail` (off-platform guest) is required. The
 * tool refines that constraint so the model cannot submit an empty
 * invitee.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';
import { assertCanSpend, chargeWorkflow, CreditsExhaustedError } from '@/lib/billing/meter';
import {
  findCalendarConnection,
  writeEventThrough,
} from '@/lib/calendar/mirror';

const parameters = z
  .object({
    contactId: z
      .string()
      .min(1)
      .optional()
      .describe('Saved Contact.id to attach. Prefer this when the guest is already in the CRM.'),
    guestName: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Used when the guest isn\'t a saved contact.'),
    guestEmail: z
      .string()
      .email()
      .max(254)
      .optional()
      .describe('Used when the guest isn\'t a saved contact.'),
    guestPhone: z.string().max(20).optional(),
    propertyAddress: z.string().max(500).optional().describe('Where the demo is.'),
    notes: z.string().max(2000).optional(),
    startsAt: z.string().datetime().describe('ISO start time.'),
    endsAt: z.string().datetime().describe('ISO end time. Must be after startsAt.'),
  })
  .refine((v) => v.contactId || (v.guestName && v.guestEmail), {
    message: 'Either contactId or both guestName + guestEmail are required.',
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt.',
  })
  .describe('Schedule a property demo for a contact or walk-in guest.');

interface ScheduleDemoResult {
  demos: Array<{
    demoId: string;
    startsAt: string;
    endsAt: string;
    contactId: string | null;
    guestName: string;
    propertyAddress: string | null;
    status: 'scheduled';
  }>;
}

export const scheduleDemoTool = defineTool<typeof parameters, ScheduleDemoResult>({
  name: 'schedule_demo',
  riskLevel: 'high',
  description:
    'Schedule a property demo. Uses a saved contact when provided, otherwise captures a walk-in guest. Always prompts for approval.',
  parameters,
  requiresApproval: true,
  rateLimit: { max: 30, windowSeconds: 3600 },
  summariseCall(args) {
    // Dates render as UTC so the approval prompt is timezone-unambiguous;
    // the demo still lands correctly because the DB stores the ISO value.
    const when = new Date(args.startsAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const who = args.contactId ? `contact ${args.contactId.slice(0, 8)}` : args.guestName ?? 'guest';
    const where = args.propertyAddress ? ` at ${args.propertyAddress}` : '';
    return `Schedule demo for ${who}${where} — ${when}`;
  },

  async handler(args, ctx) {
    // Credit gate (no-op unless CREDITS_ENFORCED). Charged on success below.
    try {
      await assertCanSpend(ctx.space.id, 'demo_booking');
    } catch (err) {
      if (err instanceof CreditsExhaustedError) {
        return {
          summary: 'Out of credits — buy a top-up or upgrade to keep booking demos.',
          display: 'error',
        };
      }
      throw err;
    }

    // Resolve guest from Contact when provided.
    let contactId: string | null = null;
    let guestName = args.guestName ?? '';
    let guestEmail = args.guestEmail ?? '';
    let guestPhone: string | null = args.guestPhone?.trim() || null;

    if (args.contactId) {
      const { data: contact, error } = await supabase
        .from('Contact')
        .select('id, name, email, phone')
        .eq('id', args.contactId)
        .eq('spaceId', ctx.space.id)
        .is('teamId', null)
        .maybeSingle();
      if (error) {
        return { summary: `Contact lookup failed: ${error.message}`, display: 'error' };
      }
      if (!contact) {
        return {
          summary: `No contact with id "${args.contactId}" in this workspace.`,
          display: 'error',
        };
      }
      contactId = contact.id;
      // Contact wins when both are provided — the saved profile is canonical.
      guestName = contact.name || guestName;
      guestEmail = contact.email || guestEmail;
      guestPhone = guestPhone ?? contact.phone ?? null;
      if (!guestEmail) {
        return {
          summary: `${contact.name} has no email on file — add one or pass guestEmail explicitly.`,
          display: 'error',
        };
      }
    }

    const demoId = crypto.randomUUID();
    const { data: inserted, error: insertErr } = await supabase
      .from('Demo')
      .insert({
        id: demoId,
        spaceId: ctx.space.id,
        contactId,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim().toLowerCase(),
        guestPhone,
        propertyAddress: args.propertyAddress?.trim() || null,
        notes: args.notes?.trim() || null,
        startsAt: new Date(args.startsAt).toISOString(),
        endsAt: new Date(args.endsAt).toISOString(),
        status: 'scheduled',
      })
      .select('id, startsAt, endsAt')
      .single();
    if (insertErr || !inserted) {
      logger.error(
        '[tools.schedule_demo] insert failed',
        { spaceId: ctx.space.id },
        insertErr,
      );
      return {
        summary: `Failed to schedule demo: ${insertErr?.message ?? 'unknown error'}`,
        display: 'error',
      };
    }

    // Audit the demo on the Contact's activity feed when linked.
    if (contactId) {
      const { error: activityErr } = await supabase.from('ContactActivity').insert({
        id: crypto.randomUUID(),
        spaceId: ctx.space.id,
        contactId,
        type: 'meeting',
        content: `Demo scheduled${args.propertyAddress ? ` at ${args.propertyAddress}` : ''}`,
        metadata: { demoId, via: 'on_demand_agent' },
      });
      if (activityErr) {
        logger.warn(
          '[tools.schedule_demo] activity insert failed',
          { contactId, demoId },
          activityErr,
        );
      }
    }

    // Write through to the rep's connected external calendar AND log
    // a CalendarEventMirror row. Best-effort: the Demo row is committed
    // either way. No connection → skip cleanly (the rep sees the
    // demo in their CRM; the calendar prompt teaches them to connect).
    try {
      const connection = await findCalendarConnection(ctx.space.id);
      if (connection) {
        const description = [
          args.propertyAddress ? `Property: ${args.propertyAddress}` : null,
          guestEmail ? `Guest: ${guestName} <${guestEmail}>` : null,
          guestPhone ? `Phone: ${guestPhone}` : null,
          args.notes ? `Notes: ${args.notes}` : null,
        ]
          .filter(Boolean)
          .join('\n');
        await writeEventThrough({
          spaceId: ctx.space.id,
          connection,
          title: `Demo: ${guestName || 'Guest'}`,
          description: description || null,
          startsAt: inserted.startsAt,
          endsAt: inserted.endsAt,
          attendees: guestEmail
            ? [{ email: guestEmail, name: guestName || null }]
            : [],
          sourceDemoId: demoId,
          createdBy: 'agent',
        });
      }
    } catch (err) {
      logger.warn(
        '[tools.schedule_demo] calendar through-write failed',
        { demoId, spaceId: ctx.space.id },
        err,
      );
    }

    const prettyTime = new Date(inserted.startsAt).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const where = args.propertyAddress ? ` at ${args.propertyAddress}` : '';
    await chargeWorkflow(ctx.space.id, 'demo_booking');
    return {
      summary: `Demo scheduled for ${guestName || 'guest'}${where} — ${prettyTime}.`,
      data: {
        demos: [
          {
            demoId: inserted.id,
            startsAt: inserted.startsAt,
            endsAt: inserted.endsAt,
            contactId,
            guestName,
            propertyAddress: args.propertyAddress?.trim() || null,
            status: 'scheduled',
          },
        ],
      },
      display: 'demos',
    };
  },
});
