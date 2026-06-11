'use client';

/**
 * /s/[slug]/whatsapp/[id] — full conversation page.
 *
 * Bubbles, paper-flat. Left-aligned for incoming, right-aligned for
 * outgoing. Hairline borders, no shadows. Timestamps grouped by day with
 * small-caps section labels (TODAY / YESTERDAY / MAY 30).
 *
 * Sticky send footer: textarea + Send pill. Enter sends; Shift+Enter
 * newline. After a successful send the message is appended optimistically
 * and the thread scrolls to the bottom.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Send } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ShimmerText } from '@/components/chippi/shimmer-text';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  CAPTION,
  META,
  SECTION_LABEL,
  PRIMARY_PILL,
} from '@/lib/typography';

interface WhatsAppMessage {
  id: string;
  fromName: string;
  fromAddress: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
}

interface OkPayload {
  ok: true;
  conversation: { id: string; contactName: string; contactPhone: string };
  messages: WhatsAppMessage[];
}

interface ErrPayload {
  ok: false;
  error: string;
}

type FetchPayload = OkPayload | ErrPayload;

interface ThreadViewProps {
  slug: string;
  conversationId: string;
  connected: boolean;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'TODAY';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'YESTERDAY';
  return d
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase();
}

export function WhatsAppThreadView({
  slug,
  conversationId,
  connected,
}: ThreadViewProps) {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [contact, setContact] = useState<{
    id: string;
    contactName: string;
    contactPhone: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!connected) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    fetch(
      `/api/whatsapp/${encodeURIComponent(conversationId)}?slug=${encodeURIComponent(slug)}`,
    )
      .then(async (res) => {
        const data = (await res.json()) as FetchPayload;
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setErrorMessage(
            ('error' in data && data.error) || 'Couldn’t load this conversation.',
          );
          return;
        }
        setMessages(data.messages);
        setContact(data.conversation);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMessage(err.message || 'Couldn’t load this conversation.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, connected, slug]);

  // Scroll to bottom on load and after appending.
  useEffect(() => {
    if (loading) return;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [loading, messages.length]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const toPhone = contact?.contactPhone || conversationId;
    const optimistic: WhatsAppMessage = {
      id: `optimistic-${Date.now()}`,
      fromName: 'You',
      fromAddress: '',
      body: text,
      sentAt: new Date().toISOString(),
      fromMe: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, to: toPhone, body: text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'That didn’t go through.');
      }
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : 'That didn’t go through.',
      );
      // Roll back optimistic on failure so the realtor sees they need to retry.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [contact?.contactPhone, conversationId, draft, sending, slug]);

  const groups = useMemo(() => {
    // Group messages by local day for the section dividers.
    const out: { key: string; label: string; items: WhatsAppMessage[] }[] = [];
    let lastKey = '';
    for (const m of messages) {
      const key = localDateKey(m.sentAt);
      if (key !== lastKey) {
        out.push({ key, label: dayLabel(m.sentAt), items: [m] });
        lastKey = key;
      } else {
        out[out.length - 1].items.push(m);
      }
    }
    return out;
  }, [messages]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full mx-auto chat-content-wrap pt-10 sm:pt-14 pb-56 md:pb-24 space-y-6 max-w-3xl">
        <Link
          href={`/s/${slug}/communication?tab=messages`}
          className={cn(
            'inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors',
          )}
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          Messages
        </Link>

        <header className="space-y-1.5">
          <p className={BODY_MUTED}>Messages.</p>
          <h1 className={H1} style={TITLE_FONT}>
            {contact?.contactName || 'Conversation'}
          </h1>
          {contact?.contactPhone && contact.contactPhone !== contact.contactName && (
            <p className={BODY_MUTED}>{contact.contactPhone}</p>
          )}
        </header>

        {loading && (
          <ShimmerText
            messages={['Pulling this conversation.']}
            className="block text-sm"
          />
        )}

        {!loading && errorMessage && (
          <Card>
            <CardContent className="p-5 space-y-2">
              <p className={BODY}>Couldn’t load this conversation.</p>
              <p className={BODY_MUTED}>{errorMessage}</p>
            </CardContent>
          </Card>
        )}

        {!loading && !errorMessage && messages.length === 0 && (
          <p className={BODY_MUTED}>Nothing here yet. Send the first message.</p>
        )}

        {!loading && !errorMessage && groups.length > 0 && (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key} className="space-y-3">
                <p className={cn(SECTION_LABEL, 'text-center')}>{g.label}</p>
                <div className="space-y-2">
                  {g.items.map((m) => (
                    <Bubble key={m.id} message={m} />
                  ))}
                </div>
              </section>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        <div className="sticky bottom-0 bg-background pt-4 pb-4 border-t border-border/60">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Write a message…"
              rows={2}
              disabled={sending || !connected}
              className="resize-none flex-1"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !connected || !draft.trim()}
              className={cn(PRIMARY_PILL, 'disabled:opacity-50 shrink-0')}
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">
                {sending ? 'Sending…' : 'Send'}
              </span>
            </button>
          </div>
          {sendError && (
            <p className="text-xs text-destructive mt-2">{sendError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: WhatsAppMessage }) {
  // Directional 4px fade — incoming drifts in from the left, outgoing from
  // the right, mirroring the bubble's side. 180ms, Apple ease. Calm enough
  // not to draw the eye away from the words.
  const fromX = message.fromMe ? 4 : -4;
  return (
    <motion.div
      className={cn(
        'flex',
        message.fromMe ? 'justify-end' : 'justify-start',
      )}
      initial={{ opacity: 0, x: fromX }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: EASE_APPLE }}
    >
      <div
        className={cn(
          'max-w-[80%] rounded-lg border border-border/60 px-3.5 py-2 space-y-1',
          message.fromMe ? 'bg-foreground/[0.04]' : 'bg-background',
        )}
      >
        <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {message.body}
        </p>
        <p className={cn(META, 'text-right')}>{formatTime(message.sentAt)}</p>
      </div>
    </motion.div>
  );
}
