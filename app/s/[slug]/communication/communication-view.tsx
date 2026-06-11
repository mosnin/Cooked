'use client';

/**
 * /s/[slug]/communication — the realtor's email, in here.
 *
 * TEMPORARY: Email-only while WhatsApp Composio config gets sorted.
 * The toggle + Messages tab + `messagesConnected` prop will return once
 * WhatsApp connect lands cleanly — leaving the props in place + the
 * components untouched (`MessagesListView`, `/whatsapp/[id]` deep-link
 * page, `/api/communication/*` endpoints) so re-enabling is one diff,
 * not a rebuild.
 *
 * Deep links into individual emails stay full pages (/email/[id]).
 */

import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { EmailInboxView } from '@/components/communication/email-inbox-view';

export type CommunicationTab = 'email' | 'messages';

interface CommunicationViewProps {
  slug: string;
  initialTab: CommunicationTab;
  emailConnected: boolean;
  emailProvider: string | null;
  /** Kept in the props shape but unused while the Messages tab is hidden.
   *  Server still computes it so re-enabling is one render-edit away. */
  messagesConnected: boolean;
}

export function CommunicationView({
  slug,
  emailConnected,
  emailProvider,
}: CommunicationViewProps) {
  const subtitle = !emailConnected
    ? 'Connect Gmail so your email lives here, not in tabs.'
    : emailProvider === 'gmail'
      ? 'Reading from Gmail.'
      : emailProvider === 'outlook'
        ? 'Reading from Outlook.'
        : 'Reading from your inbox.';

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full mx-auto chat-content-wrap pt-10 sm:pt-14 pb-56 md:pb-24 space-y-8 max-w-3xl">
        <header className="space-y-1.5 min-w-0">
          <p className={BODY_MUTED}>Communication.</p>
          <h1 className={H1} style={TITLE_FONT}>
            Your inbox, in here.
          </h1>
          <p className={BODY_MUTED}>{subtitle}</p>
        </header>

        <EmailInboxView
          slug={slug}
          initialConnected={emailConnected}
          initialProvider={emailProvider}
        />
      </div>
    </div>
  );
}
