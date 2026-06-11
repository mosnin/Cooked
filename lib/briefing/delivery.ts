/**
 * Brief delivery — opt-in email + SMS fan-out.
 *
 * Called inline from the cron right after a Brief row is upserted (so
 * the per-realtor 7am local IS the delivery moment). Per channel:
 *
 *   1. Check the opt-in (briefEmail / briefSms + master toggle).
 *   2. Atomic UPDATE-WHERE-NULL on Brief.{email,sms}SentAt to claim
 *      the lock. If no row returned, another tick already sent it.
 *   3. Send via Resend / Telnyx.
 *   4. On success: write the message ID back to the same lock column.
 *   5. On transient failure: release the lock (set back to null) so
 *      a later tick can retry within the SAME calendar day.
 *   6. On permanent failure (bounced, opt-out): keep the lock + write
 *      briefDeliveryErrorCode + auto-disable after 3 consecutive
 *      permanent failures.
 *
 * Quiet mornings (emptyState briefs) never send. Right to say nothing
 * extends to channels.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { sendSMS } from '@/lib/sms';
import { briefEmailHtml, briefEmailSubject } from './email-template';
import { buildBriefSms, BRIEF_SMS_FIRST_DISCLOSURE } from './sms-template';
import type { Brief } from './types';

interface DeliverySpaceContext {
  spaceId: string;
  spaceSlug: string;
  briefEmail: boolean;
  briefSms: boolean;
  notifications: boolean;       // master email toggle
  smsNotifications: boolean;    // master SMS toggle
  ownerEmail: string | null;
  phoneNumber: string | null;
  businessName: string | null;
  unsubscribeToken: string | null;
}

interface DeliverContext {
  briefId: string;
  brief: Brief;
  forDate: string;
  space: DeliverySpaceContext;
  appOrigin: string;
}

export interface DeliveryResult {
  email: 'sent' | 'skipped-opt-out' | 'skipped-quiet' | 'skipped-already-sent' | 'skipped-no-address' | 'failed-transient' | 'failed-permanent';
  sms: 'sent' | 'skipped-opt-out' | 'skipped-quiet' | 'skipped-already-sent' | 'skipped-no-phone' | 'failed-transient' | 'failed-permanent';
}

/**
 * Top-level fan-out. Called by the cron AFTER the Brief row exists in
 * the DB (so we have a briefId to lock against).
 */
export async function deliverBrief(ctx: DeliverContext): Promise<DeliveryResult> {
  // Quiet morning rule applies before any delivery decision.
  const isEmpty = !!ctx.brief.emptyState && ctx.brief.cards.length === 0;

  const [emailOutcome, smsOutcome] = await Promise.all([
    deliverEmail(ctx, isEmpty),
    deliverSms(ctx, isEmpty),
  ]);

  return { email: emailOutcome, sms: smsOutcome };
}

// ── Email ───────────────────────────────────────────────────────────────────

async function deliverEmail(ctx: DeliverContext, isEmpty: boolean): Promise<DeliveryResult['email']> {
  if (isEmpty) return 'skipped-quiet';
  if (!ctx.space.briefEmail || !ctx.space.notifications) return 'skipped-opt-out';
  if (!ctx.space.ownerEmail) return 'skipped-no-address';
  if (!process.env.RESEND_API_KEY) {
    logger.warn('[brief-delivery] RESEND_API_KEY not set — skipping email');
    return 'skipped-opt-out';
  }

  // Atomic claim. Whichever concurrent tick gets RETURNING wins.
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('Brief')
    .update({ emailSentAt: nowIso })
    .eq('id', ctx.briefId)
    .is('emailSentAt', null)
    .select('id')
    .maybeSingle();

  if (claimErr || !claimed) return 'skipped-already-sent';

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const unsubscribeUrl = ctx.space.unsubscribeToken
      ? `${ctx.appOrigin}/api/brief/unsubscribe?token=${encodeURIComponent(ctx.space.unsubscribeToken)}`
      : `${ctx.appOrigin}/s/${ctx.space.spaceSlug}/settings?tab=privacy#brief`;

    const subject = briefEmailSubject(ctx.brief);
    const html = briefEmailHtml({
      brief: ctx.brief,
      spaceSlug: ctx.space.spaceSlug,
      briefDate: ctx.forDate,
      appOrigin: ctx.appOrigin,
      unsubscribeUrl,
      businessName: ctx.space.businessName,
    });

    const result = await resend.emails.send({
      from: `Chippi <brief@${getBriefDomain()}>`,
      to: ctx.space.ownerEmail,
      subject,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (result.error) {
      const code = classifyResendError(result.error);
      logger.warn('[brief-delivery] email send returned error', { briefId: ctx.briefId, code });
      return await handleEmailFailure(ctx.briefId, code);
    }

    const messageId = result.data?.id ?? null;
    await supabase
      .from('Brief')
      .update({ emailMessageId: messageId, briefDeliveryErrorCode: null })
      .eq('id', ctx.briefId);

    logger.info('[brief-delivery] email sent', { briefId: ctx.briefId, messageId });
    return 'sent';
  } catch (err) {
    logger.error('[brief-delivery] email send threw', { briefId: ctx.briefId }, err as Error);
    return await handleEmailFailure(ctx.briefId, 'transient');
  }
}

async function handleEmailFailure(briefId: string, code: 'transient' | 'permanent'): Promise<DeliveryResult['email']> {
  if (code === 'transient') {
    // Release the lock so the next tick retries within today.
    await supabase
      .from('Brief')
      .update({ emailSentAt: null })
      .eq('id', briefId)
      .is('emailMessageId', null);
    return 'failed-transient';
  }
  // Permanent — keep the lock, write the error code, surface in tomorrow's
  // brief. Auto-disable after 3 consecutive permanent failures (counted
  // by a separate per-space scan in the cron — not done here to keep this
  // function pure-per-brief).
  await supabase
    .from('Brief')
    .update({ briefDeliveryErrorCode: `email_${code}` })
    .eq('id', briefId);
  return 'failed-permanent';
}

function classifyResendError(error: { name?: string; message?: string } | null | undefined): 'transient' | 'permanent' {
  if (!error) return 'transient';
  const name = (error.name ?? '').toLowerCase();
  const msg = (error.message ?? '').toLowerCase();
  // Permanent classes per Resend's typical error names.
  if (name.includes('invalid') || name.includes('not_found') || msg.includes('bounce') || msg.includes('invalid')) {
    return 'permanent';
  }
  return 'transient';
}

function getBriefDomain(): string {
  // Sender subdomain — keeps brief reputation isolated from
  // notifications@. Env-driven so staging can use a different domain.
  return process.env.BRIEF_EMAIL_DOMAIN ?? 'alerts.usechippi.com';
}

// ── SMS ─────────────────────────────────────────────────────────────────────

async function deliverSms(ctx: DeliverContext, isEmpty: boolean): Promise<DeliveryResult['sms']> {
  if (isEmpty) return 'skipped-quiet';
  if (!ctx.space.briefSms || !ctx.space.smsNotifications) return 'skipped-opt-out';
  if (!ctx.space.phoneNumber) return 'skipped-no-phone';

  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('Brief')
    .update({ smsSentAt: nowIso })
    .eq('id', ctx.briefId)
    .is('smsSentAt', null)
    .select('id')
    .maybeSingle();

  if (claimErr || !claimed) return 'skipped-already-sent';

  try {
    // Check if this is the realtor's FIRST-EVER brief SMS. If so, send
    // the one-time opt-in disclosure first as its own message.
    const { count: priorSends } = await supabase
      .from('Brief')
      .select('id', { count: 'exact', head: true })
      .eq('spaceId', ctx.space.spaceId)
      .not('smsSentAt', 'is', null)
      .neq('id', ctx.briefId);

    if ((priorSends ?? 0) === 0) {
      await sendSMS({ to: ctx.space.phoneNumber, body: BRIEF_SMS_FIRST_DISCLOSURE });
    }

    const { body } = buildBriefSms({
      headline: ctx.brief.headline,
      spaceSlug: ctx.space.spaceSlug,
      briefDate: ctx.forDate,
      appOrigin: ctx.appOrigin,
    });

    const sent = await sendSMS({ to: ctx.space.phoneNumber, body });
    if (!sent) {
      // sendSMS already classifies/logs internally — treat as transient
      // and release the lock so we retry within today.
      await supabase
        .from('Brief')
        .update({ smsSentAt: null })
        .eq('id', ctx.briefId)
        .is('smsMessageId', null);
      return 'failed-transient';
    }

    await supabase
      .from('Brief')
      .update({ briefDeliveryErrorCode: null })
      .eq('id', ctx.briefId);

    logger.info('[brief-delivery] sms sent', { briefId: ctx.briefId });
    return 'sent';
  } catch (err) {
    logger.error('[brief-delivery] sms send threw', { briefId: ctx.briefId }, err as Error);
    await supabase
      .from('Brief')
      .update({ smsSentAt: null })
      .eq('id', ctx.briefId)
      .is('smsMessageId', null);
    return 'failed-transient';
  }
}

// ── Context loader — pulled out so the cron and the /test endpoint share it ─

export async function loadDeliveryContext(spaceId: string): Promise<DeliverySpaceContext | null> {
  const { data: settings } = await supabase
    .from('SpaceSetting')
    .select(
      'briefEmail, briefSms, notifications, smsNotifications, phoneNumber, businessName, unsubscribeToken',
    )
    .eq('spaceId', spaceId)
    .maybeSingle();

  if (!settings) return null;

  const { data: space } = await supabase
    .from('Space')
    .select('id, slug, ownerId')
    .eq('id', spaceId)
    .maybeSingle();

  if (!space) return null;

  const { data: owner } = await supabase
    .from('User')
    .select('email')
    .eq('id', space.ownerId)
    .maybeSingle();

  return {
    spaceId,
    spaceSlug: space.slug as string,
    briefEmail: settings.briefEmail ?? false,
    briefSms: settings.briefSms ?? false,
    notifications: settings.notifications ?? true,
    smsNotifications: settings.smsNotifications ?? false,
    ownerEmail: (owner?.email as string | null) ?? null,
    phoneNumber: settings.phoneNumber as string | null,
    businessName: settings.businessName as string | null,
    unsubscribeToken: settings.unsubscribeToken as string | null,
  };
}

export function getAppOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ORIGIN ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    'https://my.usechippi.com'
  ).replace(/\/$/, '');
}
