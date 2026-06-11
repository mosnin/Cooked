/**
 * Email template for the daily brief.
 *
 * Subject = the brief's headline verbatim, capped at 80 chars. No prefix,
 * no [Chippi], no emoji. The realtor's inbox should look like a one-line
 * note from a colleague.
 *
 * Body = headline + subheadline + ONE Open in Chippi CTA. No inline cards,
 * no card previews. The full brief lives in the app. Email is bait, not
 * body — per the delivery design rule.
 *
 * RFC 8058 one-click unsubscribe via the `unsubscribeUrl` link + a
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header set on the
 * Resend send. Gmail / Apple Mail render the native unsubscribe button.
 */

import type { Brief } from './types';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function briefEmailSubject(brief: Brief): string {
  return brief.headline.replace(/[\r\n\t]/g, ' ').slice(0, 80);
}

export interface BriefEmailHtmlParams {
  brief: Brief;
  spaceSlug: string;
  briefDate: string; // YYYY-MM-DD
  appOrigin: string; // e.g. https://my.usechippi.com — no trailing slash
  unsubscribeUrl: string;
  businessName: string | null;
}

/**
 * Builds the HTML body. Mirrors the in-app brief's visual hierarchy:
 * title-serif headline, muted subheadline, CTA pill. No card list.
 */
export function briefEmailHtml(params: BriefEmailHtmlParams): string {
  const { brief, spaceSlug, briefDate, appOrigin, unsubscribeUrl, businessName } = params;
  const deepLink = `${appOrigin}/s/${encodeURIComponent(spaceSlug)}/chippi?brief=${encodeURIComponent(briefDate)}`;
  const dateLine = formatDateLabel(briefDate);
  const subhead = brief.subheadline ? `<p style="margin:14px 0 0;font-size:14px;color:#6b7280;line-height:1.55">${esc(brief.subheadline)}</p>` : '';
  const footerName = esc(businessName ?? 'your workspace');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="padding:28px 32px 12px;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#9ca3af">
          Chippi · ${esc(dateLine)}
        </td></tr>
        <tr><td style="padding:0 32px 24px">
          <h1 style="margin:0;font-size:24px;line-height:1.25;color:#111827;font-family:Times,serif;font-weight:normal">${esc(brief.headline)}</h1>
          ${subhead}
        </td></tr>
        <tr><td style="padding:0 32px 28px">
          <a href="${esc(deepLink)}" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 18px;border-radius:9999px;text-decoration:none;font-size:14px;font-weight:500">Open today&#39;s brief &rarr;</a>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9">
          <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6">
            You&#39;re getting this because the daily brief is on for ${footerName}. Turn it off any time.
          </p>
          <p style="margin:6px 0 0;font-size:11px;color:#9ca3af;line-height:1.6">
            <a href="${esc(`${appOrigin}/s/${encodeURIComponent(spaceSlug)}/settings?tab=privacy#brief`)}" style="color:#6b7280;text-decoration:underline">Manage</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Unsubscribe from the brief</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function formatDateLabel(yyyymmdd: string): string {
  // YYYY-MM-DD assumed UTC-naive — render as local-date without timezone math.
  const [y, m, d] = yyyymmdd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return yyyymmdd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
