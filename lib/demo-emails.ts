/**
 * Demo email notifications.
 *
 * Uses Resend (same transport as lib/email.ts) when RESEND_API_KEY is set.
 * Falls back to console logging in dev when no key is configured.
 *
 * Four email types:
 *   1. Confirmation — sent immediately when a demo is booked (to guest)
 *   2. Reminder — sent ~24h before the demo starts (to guest, via cron)
 *   3. Follow-up — sent after a demo is completed (to guest)
 *   4. Agent notification — sent to space owner when a demo is booked
 */

export interface DemoEmailData {
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  propertyAddress: string | null;
  startsAt: string; // ISO
  endsAt: string;   // ISO
  businessName: string;
  demoId: string;
  slug: string;
}

/** Escape HTML special characters to prevent XSS in email templates. */
function esc(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Shared email wrapper matching the design from lib/email.ts */
function wrapHtml(header: string, subtitle: string, bodyContent: string, footer: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="background:#0f172a;padding:20px 28px">
          <p style="margin:0;color:#94a3b8;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.05em">${esc(header)}</p>
          <p style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700">${esc(subtitle)}</p>
        </td></tr>
        <tr><td style="padding:24px 28px">
          ${bodyContent}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9">
          <p style="margin:0;font-size:11px;color:#9ca3af">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function detailBox(items: { label: string; value: string }[]): string {
  const rows = items
    .filter((i) => i.value)
    .map((i) => `<p style="margin:4px 0;font-size:14px;color:#111827"><strong style="color:#6b7280">${esc(i.label)}:</strong> ${esc(i.value)}</p>`)
    .join('');
  return `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #f1f5f9">${rows}</div>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[demo-email] (dev) To: ${to} | Subject: ${subject}`);
    console.log(`[demo-email] (dev) HTML preview:\n${html.replace(/<[^>]+>/g, '').slice(0, 300)}...`);
    return;
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const rawFrom = process.env.RESEND_FROM_EMAIL ?? 'notifications@alerts.usekoala.com';
    const FROM = rawFrom.includes('@') ? rawFrom : `notifications@${rawFrom}`;
    const safeSubject = subject.replace(/[\r\n\t]/g, ' ').slice(0, 200);
    const result = await resend.emails.send({ from: FROM, to, subject: safeSubject, html });
    if (result.error) {
      console.error(`[demo-email] Resend API error for "${subject}" to ${to}:`, JSON.stringify(result.error));
    } else {
      console.log(`[demo-email] Sent "${subject}" to ${to}`, JSON.stringify(result.data));
    }
  } catch (err) {
    console.error('[demo-email] Send failed:', err);
  }
}

export async function sendDemoConfirmation(data: DemoEmailData) {
  const { guestName, guestEmail, businessName, startsAt, endsAt, propertyAddress } = data;
  const subject = `Demo Confirmed — ${formatDate(startsAt)}`;

  const body = `
    <p style="margin:0 0 12px;font-size:15px;color:#111827;line-height:1.6">Hi ${esc(guestName)},</p>
    <p style="margin:0 0 4px;font-size:15px;color:#111827;line-height:1.6">Your demo with <strong>${esc(businessName)}</strong> has been confirmed:</p>
    ${detailBox([
      { label: 'Date', value: formatDate(startsAt) },
      { label: 'Time', value: `${formatTime(startsAt)} – ${formatTime(endsAt)}` },
      { label: 'Property', value: propertyAddress ?? '' },
    ])}
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.5">If you need to reschedule or cancel, please reply to this email.</p>
  `;

  const html = wrapHtml(businessName, 'Demo confirmed', body, `Sent by ${esc(businessName)}`);
  await sendEmail(guestEmail, subject, html);
}

export async function sendDemoReminder(data: DemoEmailData) {
  const { guestName, guestEmail, businessName, startsAt, endsAt, propertyAddress } = data;
  const subject = `Reminder: Demo Tomorrow — ${formatTime(startsAt)}`;

  const body = `
    <p style="margin:0 0 12px;font-size:15px;color:#111827;line-height:1.6">Hi ${esc(guestName)},</p>
    <p style="margin:0 0 4px;font-size:15px;color:#111827;line-height:1.6">Friendly reminder — you have a demo scheduled tomorrow with <strong>${esc(businessName)}</strong>:</p>
    ${detailBox([
      { label: 'Date', value: formatDate(startsAt) },
      { label: 'Time', value: `${formatTime(startsAt)} – ${formatTime(endsAt)}` },
      { label: 'Property', value: propertyAddress ?? '' },
    ])}
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.5">We look forward to seeing you!</p>
  `;

  const html = wrapHtml(businessName, 'Demo reminder', body, `Sent by ${esc(businessName)}`);
  await sendEmail(guestEmail, subject, html);
}

export async function sendDemoFollowUp(data: DemoEmailData) {
  const { guestName, guestEmail, businessName, propertyAddress } = data;
  const subject = `Thanks for demoing with ${businessName}!`;

  const body = `
    <p style="margin:0 0 12px;font-size:15px;color:#111827;line-height:1.6">Hi ${esc(guestName)},</p>
    <p style="margin:0 0 4px;font-size:15px;color:#111827;line-height:1.6">
      Thank you for demoing${propertyAddress ? ` <strong>${esc(propertyAddress)}</strong>` : ''} with us. We hope you enjoyed the visit.
    </p>
    <p style="margin:12px 0 0;font-size:14px;color:#374151;line-height:1.5">
      If you have any questions or would like to move forward, simply reply to this email and we'll get back to you right away.
    </p>
    <p style="margin:16px 0 0;font-size:14px;color:#111827">Best regards,<br/><strong>${esc(businessName)}</strong></p>
  `;

  const html = wrapHtml(businessName, 'Thanks for visiting!', body, `Sent by ${esc(businessName)}`);
  await sendEmail(guestEmail, subject, html);
}

export async function sendAgentNotification(agentEmail: string, data: DemoEmailData) {
  const { guestName, guestEmail, guestPhone = null, startsAt, propertyAddress, businessName, slug } = data;
  const subject = `New Demo Booked — ${guestName} on ${formatDate(startsAt)}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://my.usekoala.com';
  const demosUrl = `${appUrl}/s/${slug}/calendar`;

  const body = `
    ${detailBox([
      { label: 'Guest', value: guestName },
      { label: 'Email', value: guestEmail },
      { label: 'Phone', value: guestPhone ?? '' },
      { label: 'Date', value: `${formatDate(startsAt)} at ${formatTime(startsAt)}` },
      { label: 'Property', value: propertyAddress ?? '' },
    ])}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
      <tr><td>
        <a href="${demosUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:8px">View demos →</a>
      </td></tr>
    </table>
  `;

  const html = wrapHtml(businessName || 'Demo', 'New demo booking', body, `You're receiving this because a guest booked a demo on your workspace.`);
  await sendEmail(agentEmail, subject, html);
}
