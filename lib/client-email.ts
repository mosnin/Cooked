/**
 * Client-portal transactional email (Resend). Verification / login codes and
 * portal notifications for end users. Mirrors lib/email.ts's setup. No-ops
 * cleanly when RESEND_API_KEY is unset so local/dev never throws.
 */
import 'server-only';
import { Resend } from 'resend';
import { logger } from '@/lib/logger';

function fromAddress(): string {
  const raw = process.env.RESEND_FROM_EMAIL ?? 'notifications@alerts.usechippi.com';
  return raw.includes('@') ? raw : `notifications@${raw}`;
}

function portalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_CLIENTS_URL ||
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://my.usechippi.com'}/clients`
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fff;color:#111;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
    <div style="max-width:480px;margin:0 auto;padding:40px 24px">
      <h1 style="font-family:Tinos,Times,serif;font-size:22px;font-weight:600;margin:0 0 16px">${esc(heading)}</h1>
      ${bodyHtml}
      <p style="color:#999;font-size:12px;margin-top:32px">Chippi · client portal</p>
    </div>
  </body></html>`;
}

const PURPOSE_COPY: Record<'verify' | 'login' | 'reset', { subject: string; heading: string; line: string }> = {
  verify: { subject: 'Verify your email', heading: 'Verify your email', line: 'Enter this code to verify your email and finish setting up your account.' },
  login: { subject: 'Your sign-in code', heading: 'Your sign-in code', line: 'Enter this code to sign in.' },
  reset: { subject: 'Reset your password', heading: 'Reset your password', line: 'Enter this code to reset your password.' },
};

export async function sendClientCode(params: {
  to: string;
  code: string;
  purpose: 'verify' | 'login' | 'reset';
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('[client-email] RESEND_API_KEY unset — code email skipped', { purpose: params.purpose });
    return;
  }
  const copy = PURPOSE_COPY[params.purpose];
  const html = shell(
    copy.heading,
    `<p style="font-size:14px;color:#444;margin:0 0 20px">${esc(copy.line)}</p>
     <div style="font-family:ui-monospace,monospace;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#f5f5f5;border-radius:12px">${esc(params.code)}</div>
     <p style="font-size:12px;color:#999;margin-top:16px">This code expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
  );
  try {
    await new Resend(apiKey).emails.send({
      from: fromAddress(),
      to: params.to,
      subject: copy.subject,
      html,
    });
  } catch (err) {
    logger.error('[client-email] code send failed', { purpose: params.purpose }, err);
  }
}

/** Generic portal notification (new message from realtor, info request, status change). */
export async function sendClientNotification(params: {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('[client-email] RESEND_API_KEY unset — notification skipped');
    return;
  }
  const cta =
    params.ctaLabel && params.ctaHref
      ? `<a href="${esc(params.ctaHref)}" style="display:inline-block;margin-top:20px;background:#111;color:#fff;text-decoration:none;border-radius:9999px;padding:10px 20px;font-size:14px;font-weight:500">${esc(params.ctaLabel)}</a>`
      : `<a href="${esc(portalUrl())}" style="display:inline-block;margin-top:20px;background:#111;color:#fff;text-decoration:none;border-radius:9999px;padding:10px 20px;font-size:14px;font-weight:500">Open your portal</a>`;
  const html = shell(
    params.heading,
    `<p style="font-size:14px;color:#444;margin:0">${esc(params.body)}</p>${cta}`,
  );
  try {
    await new Resend(apiKey).emails.send({
      from: fromAddress(),
      to: params.to,
      subject: params.subject,
      html,
    });
  } catch (err) {
    logger.error('[client-email] notification send failed', {}, err);
  }
}
