'use client';

/**
 * /s/[slug]/email/[id] — full-page email read.
 *
 * The subject is the page's serif h1 — the body of the page IS the body
 * of the email. Sender + time recede below the title; recipients tuck
 * into a single line. The body renders as plain text with whitespace
 * preserved.
 *
 * Affordances live in one row above the body: Reply (primary), Star
 * (toggle), Open in Gmail (ghost link). Back to inbox is a quiet top-
 * left link, separate from the action row.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, ExternalLink, Reply } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ShimmerText } from '@/components/chippi/shimmer-text';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  CAPTION,
  PRIMARY_PILL,
  GHOST_PILL,
} from '@/lib/typography';
import {
  EmailComposeDialog,
  EmailStarPulse,
} from '@/components/communication/email-inbox-view';

interface EmailMessage {
  id: string;
  threadId: string;
  fromName: string;
  fromAddress: string;
  to: { name: string; address: string }[];
  cc: { name: string; address: string }[];
  subject: string | null;
  body: string;
  sentAt: string;
  starred: boolean;
  webLink: string | null;
}

interface OkPayload {
  ok: true;
  message: EmailMessage;
}

interface ErrPayload {
  ok: false;
  error: string;
}

type FetchPayload = OkPayload | ErrPayload;

interface EmailReadViewProps {
  slug: string;
  messageId: string;
  connected: boolean;
}

function formatExact(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function describeAddress(a: { name: string; address: string }): string {
  if (a.name && a.address) return `${a.name} <${a.address}>`;
  return a.name || a.address;
}

function formatRecipientLine(
  list: { name: string; address: string }[],
): string {
  return list.map(describeAddress).join(', ');
}

function buildQuotedReply(msg: EmailMessage): string {
  const sentLine = `On ${formatExact(msg.sentAt)}, ${msg.fromName || msg.fromAddress || 'they'} wrote:`;
  // Don't prefix every line with "> " — on long HTML-stripped automated
  // emails (webhooks, marketing) that produces a wall of `>` chars. Single
  // em-dashed separator + raw body reads cleaner; realtor can trim or
  // delete what they don't want. Cap at 2000 chars so the composer doesn't
  // open with 50 screens of newsletter noise.
  const MAX = 2000;
  const body =
    msg.body.length > MAX ? msg.body.slice(0, MAX).trimEnd() + '\n\n[…]' : msg.body;
  return `\n\n\n──── ${sentLine}\n\n${body}`;
}

function buildReplySubject(subject: string | null): string {
  if (!subject) return 'Re:';
  if (/^re:/i.test(subject.trim())) return subject;
  return `Re: ${subject}`;
}

export function EmailReadView({
  slug,
  messageId,
  connected,
}: EmailReadViewProps) {
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [starBusy, setStarBusy] = useState(false);

  useEffect(() => {
    if (!connected) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    fetch(
      `/api/email/${encodeURIComponent(messageId)}?slug=${encodeURIComponent(slug)}`,
    )
      .then(async (res) => {
        const data = (await res.json()) as FetchPayload;
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setErrorMessage(
            ('error' in data && data.error) || 'Could not load this email.',
          );
          return;
        }
        setMessage(data.message);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMessage(err.message || 'Could not load this email.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, messageId, slug]);

  const handleStar = useCallback(async () => {
    if (!message || starBusy) return;
    const next = !message.starred;
    setStarBusy(true);
    setMessage((prev) => (prev ? { ...prev, starred: next } : prev));
    try {
      const res = await fetch('/api/email/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, messageId: message.id, starred: next }),
      });
      if (!res.ok) throw new Error('star failed');
    } catch {
      setMessage((prev) => (prev ? { ...prev, starred: !next } : prev));
    } finally {
      setStarBusy(false);
    }
  }, [message, slug, starBusy]);

  const replyInitial = useMemo(() => {
    if (!message) return undefined;
    return {
      to: message.fromAddress,
      subject: buildReplySubject(message.subject),
      body: buildQuotedReply(message),
    };
  }, [message]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full mx-auto chat-content-wrap pt-10 sm:pt-14 pb-56 md:pb-24 space-y-6 max-w-3xl">
        <Link
          href={`/s/${slug}/communication?tab=email`}
          className={cn(
            'inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors',
          )}
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          Inbox
        </Link>

        {loading && (
          <ShimmerText
            messages={['Opening the email.', 'Pulling the body.']}
            className="block text-sm"
          />
        )}

        {!loading && errorMessage && (
          <Card>
            <CardContent className="p-5 space-y-2">
              <p className={BODY}>I couldn’t open this email.</p>
              <p className={BODY_MUTED}>{errorMessage}</p>
            </CardContent>
          </Card>
        )}

        {!loading && !errorMessage && message && (
          /* Page-level fade-in for the whole read view; the serif subject
           *  scales from 0.98 → 1 with the same fade to give the headline
           *  an unmistakable but quiet arrival. 220ms, Apple ease. */
          <motion.article
            className="space-y-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, ease: EASE_APPLE }}
          >
            <header className="space-y-3">
              <motion.h1
                className={H1}
                style={TITLE_FONT}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.22, ease: EASE_APPLE }}
              >
                {message.subject || '(no subject)'}
              </motion.h1>
              <div className="space-y-1">
                <p className={BODY}>
                  <span className="font-medium">
                    {message.fromName || message.fromAddress || '(unknown sender)'}
                  </span>
                  {message.fromAddress && message.fromAddress !== message.fromName && (
                    <span className={cn(BODY_MUTED, 'ml-2')}>
                      {message.fromAddress}
                    </span>
                  )}
                </p>
                <p className={CAPTION}>{formatExact(message.sentAt)}</p>
                {message.to.length > 0 && (
                  <p className={CAPTION}>
                    To: {formatRecipientLine(message.to)}
                  </p>
                )}
                {message.cc.length > 0 && (
                  <p className={CAPTION}>
                    Cc: {formatRecipientLine(message.cc)}
                  </p>
                )}
              </div>
            </header>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setReplyOpen(true)}
                className={cn(PRIMARY_PILL)}
              >
                <Reply className="h-4 w-4" />
                Reply
              </button>
              <button
                type="button"
                onClick={handleStar}
                disabled={starBusy}
                className={cn(
                  GHOST_PILL,
                  'border border-border/70 transition-transform duration-150 active:scale-[0.98]',
                )}
                aria-label={message.starred ? 'Unstar' : 'Star'}
              >
                {/* Same pulse as the inbox row — false→true triggers a
                 *  one-shot 180ms scale; first paint and unstar are quiet. */}
                <EmailStarPulse
                  starred={message.starred}
                  size={14}
                  className={cn(
                    'transition-colors duration-200',
                    message.starred
                      ? 'fill-amber-500 text-amber-500'
                      : 'text-muted-foreground',
                  )}
                />
                {message.starred ? 'Starred' : 'Star'}
              </button>
              {message.webLink && (
                <a
                  href={message.webLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(GHOST_PILL, 'border border-border/70')}
                >
                  <ExternalLink size={14} strokeWidth={1.75} />
                  Open in Gmail
                </a>
              )}
            </div>

            <div className="border-t border-border/60 pt-6">
              <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                {message.body || '(no body)'}
              </div>
            </div>
          </motion.article>
        )}

        <EmailComposeDialog
          open={replyOpen}
          onClose={() => setReplyOpen(false)}
          slug={slug}
          onSent={() => setReplyOpen(false)}
          initial={replyInitial}
        />
      </div>
    </div>
  );
}
