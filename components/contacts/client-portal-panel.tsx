'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Send,
  Loader2,
  File as FileIcon,
  Download,
  HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Client-portal panel on the realtor contact detail. Mirrors the collapsible
 * <details> pattern used by the other sections. Three things in one calm
 * surface: the portal message thread (realtor replies here), the documents the
 * client uploaded, and a "request info" action.
 *
 * Everything loads lazily on first open so the contact page stays fast.
 */

interface Message {
  id: string;
  senderType: 'client' | 'realtor';
  body: string;
  createdAt: string;
}
interface Doc {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  uploadedBy: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ClientPortalPanel({ contactId }: { contactId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);

  async function load() {
    if (loaded) return;
    const [mRes, dRes] = await Promise.all([
      fetch(`/api/contacts/${contactId}/client-messages`),
      fetch(`/api/contacts/${contactId}/client-documents`),
    ]);
    if (mRes.ok) {
      const data = await mRes.json();
      if (Array.isArray(data.messages)) setMessages(data.messages);
    }
    if (dRes.ok) {
      const data = await dRes.json();
      if (Array.isArray(data.documents)) setDocs(data.documents);
    }
    setLoaded(true);
  }

  return (
    <details
      className="group border-t border-border/60 pt-4"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-foreground transition-colors hover:text-foreground/80">
        <span className="inline-flex items-center gap-2">
          <Send size={13} className="text-muted-foreground" />
          Client portal
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Hide</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="mt-4 space-y-6">
        <RequestInfo contactId={contactId} />
        <Thread contactId={contactId} messages={messages} setMessages={setMessages} />
        <ClientDocs contactId={contactId} docs={docs} />
      </div>
    </details>
  );
}

/* ─── Request info ────────────────────────────────────────────────────────── */

function RequestInfo({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!message.trim() || pending) return;
    setPending(true);
    const res = await fetch(`/api/contacts/${contactId}/info-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() }),
    });
    setPending(false);
    if (res.ok) {
      toast.success('Request sent.');
      setMessage('');
      setOpen(false);
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error((data.error as string) ?? "Couldn't send that.");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <HelpCircle size={13} />
        Request info
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-card px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Ask the client for something
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        maxLength={1000}
        autoFocus
        placeholder="e.g. could you upload your most recent pay stub?"
        className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!message.trim() || pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-all duration-150 hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Send request
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ─── Thread ──────────────────────────────────────────────────────────────── */

function Thread({
  contactId,
  messages,
  setMessages,
}: {
  contactId: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    const res = await fetch(`/api/contacts/${contactId}/client-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text.trim() }),
    });
    setSending(false);
    if (res.ok) {
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setText('');
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error((data.error as string) ?? "Message didn't send.");
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Messages</p>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No portal messages yet.</p>
          ) : (
            messages.map((m) => {
              const isRealtor = m.senderType === 'realtor';
              return (
                <div key={m.id} className={cn('flex', isRealtor ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-xl px-3.5 py-2.5',
                      isRealtor
                        ? 'rounded-br-sm bg-foreground text-background'
                        : 'rounded-bl-sm bg-muted text-foreground',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                    <time
                      dateTime={m.createdAt}
                      className={cn(
                        'mt-1 block text-[11px] tabular-nums',
                        isRealtor ? 'text-background/60' : 'text-muted-foreground',
                      )}
                    >
                      {formatTime(m.createdAt)}
                    </time>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-border/60 px-3 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Reply to the client…"
              className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            />
            <button
              type="button"
              onClick={send}
              disabled={!text.trim() || sending}
              aria-label="Send reply"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-all duration-150 hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Client documents ────────────────────────────────────────────────────── */

function ClientDocs({ contactId, docs }: { contactId: string; docs: Doc[] }) {
  async function download(id: string) {
    const res = await fetch(`/api/contacts/${contactId}/client-documents?id=${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank', 'noopener');
    }
  }

  if (docs.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Documents from the client
      </p>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {docs.map((doc) => (
          <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
            <FileIcon size={15} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{doc.fileName}</p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {doc.uploadedBy === 'client' ? 'client' : 'agent'}
                {formatSize(doc.sizeBytes) ? ` · ${formatSize(doc.sizeBytes)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => download(doc.id)}
              aria-label={`Download ${doc.fileName}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
            >
              <Download size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
