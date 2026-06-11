'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Loader2,
  Upload,
  File as FileIcon,
  Download,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface Message {
  id: string;
  senderType: 'client' | 'realtor';
  body: string;
  createdAt: string;
}
interface Doc {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedBy: string;
  createdAt: string;
}
interface InfoRequest {
  id: string;
  message: string;
  status: 'pending' | 'fulfilled';
  response: string | null;
  createdAt: string;
  fulfilledAt: string | null;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

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

const SECTION_LABEL = 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground';

/* ─── Main ────────────────────────────────────────────────────────────────── */

export function ApplicationDetailClient({
  contactId,
  initialMessages,
  initialDocuments,
  initialRequests,
}: {
  contactId: string;
  initialMessages: Message[];
  initialDocuments: Doc[];
  initialRequests: InfoRequest[];
}) {
  return (
    <div className="space-y-12">
      <InfoRequests contactId={contactId} initial={initialRequests} />
      <Thread contactId={contactId} initial={initialMessages} />
      <Documents contactId={contactId} initial={initialDocuments} />
    </div>
  );
}

/* ─── Info-requests ───────────────────────────────────────────────────────── */

function InfoRequests({ contactId, initial }: { contactId: string; initial: InfoRequest[] }) {
  const [requests, setRequests] = useState<InfoRequest[]>(initial);
  const pending = requests.filter((r) => r.status === 'pending');
  if (requests.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className={SECTION_LABEL}>
        {pending.length > 0 ? 'Your agent needs something' : 'Requests'}
      </h2>
      <ul className="space-y-3">
        {requests.map((r) => (
          <InfoRequestRow
            key={r.id}
            request={r}
            onAnswered={(response) =>
              setRequests((prev) =>
                prev.map((p) =>
                  p.id === r.id
                    ? { ...p, status: 'fulfilled', response, fulfilledAt: new Date().toISOString() }
                    : p,
                ),
              )
            }
          />
        ))}
      </ul>
    </section>
  );
}

function InfoRequestRow({
  request,
  onAnswered,
}: {
  request: InfoRequest;
  onAnswered: (response: string) => void;
}) {
  const [response, setResponse] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!response.trim() || pending) return;
    setPending(true);
    setError(null);
    const res = await fetch('/api/clients/info-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: request.id, response: response.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data.error as string) ?? "That didn't go through. Try again.");
      setPending(false);
      return;
    }
    onAnswered(response.trim());
  }

  return (
    <li className="rounded-xl border border-border/70 bg-card px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <HelpCircle size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-sm text-foreground">{request.message}</p>
      </div>

      {request.status === 'fulfilled' ? (
        <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Your answer
          </p>
          <p className="mt-0.5 text-sm text-foreground">{request.response}</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            disabled={pending}
            rows={2}
            maxLength={2000}
            placeholder="Type your answer…"
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={!response.trim() || pending}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-all duration-150 hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50"
          >
            {pending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Send answer
          </button>
        </div>
      )}
    </li>
  );
}

/* ─── Message thread ──────────────────────────────────────────────────────── */

function Thread({ contactId, initial }: { contactId: string; initial: Message[] }) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for realtor replies every 30s — calm, no live-indicator chrome.
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/clients/messages?contactId=${encodeURIComponent(contactId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) setMessages(data.messages);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [contactId]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch('/api/clients/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, body: text.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data.error as string) ?? "Message didn't send. Try again.");
      setSending(false);
      return;
    }
    const data = await res.json();
    setMessages((prev) => [...prev, data.message]);
    setText('');
    setSending(false);
  }

  return (
    <section className="space-y-4">
      <h2 className={SECTION_LABEL}>Messages</h2>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="max-h-96 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No messages yet. Say hello to your agent below.
            </p>
          ) : (
            messages.map((m) => {
              const isClient = m.senderType === 'client';
              return (
                <div key={m.id} className={cn('flex', isClient ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-xl px-3.5 py-2.5',
                      isClient
                        ? 'rounded-br-sm bg-foreground text-background'
                        : 'rounded-bl-sm bg-muted text-foreground',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                    <time
                      dateTime={m.createdAt}
                      className={cn(
                        'mt-1 block text-[11px] tabular-nums',
                        isClient ? 'text-background/60' : 'text-muted-foreground',
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
          {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
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
              placeholder="Write a message…"
              disabled={sending}
              className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50"
            />
            <button
              type="button"
              onClick={send}
              disabled={!text.trim() || sending}
              aria-label="Send message"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-all duration-150 hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Documents ───────────────────────────────────────────────────────────── */

function Documents({ contactId, initial }: { contactId: string; initial: Doc[] }) {
  const [docs, setDocs] = useState<Doc[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large (max 10MB).');
      return;
    }
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append('contactId', contactId);
    form.append('file', file);
    const res = await fetch('/api/clients/documents', { method: 'POST', body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data.error as string) ?? "Upload didn't go through. Try again.");
      setUploading(false);
      return;
    }
    const data = await res.json();
    setDocs((prev) => [data.document, ...prev]);
    setUploading(false);
  }

  async function download(id: string) {
    const res = await fetch(
      `/api/clients/documents?contactId=${encodeURIComponent(contactId)}&id=${encodeURIComponent(id)}`,
    );
    if (res.ok) {
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank', 'noopener');
    }
  }

  return (
    <section className="space-y-4">
      <h2 className={SECTION_LABEL}>Documents</h2>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        className={cn(
          'cursor-pointer rounded-xl border border-dashed px-5 py-8 text-center transition-colors',
          dragOver ? 'border-foreground/40 bg-foreground/[0.04]' : 'border-border/70 bg-muted/20 hover:bg-muted/30',
          uploading && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        {uploading ? (
          <Loader2 size={20} className="mx-auto mb-2 animate-spin text-muted-foreground" />
        ) : (
          <Upload size={20} className="mx-auto mb-2 text-muted-foreground" />
        )}
        <p className="text-sm text-foreground">
          {uploading ? 'Uploading…' : 'Drop a file here, or click to upload.'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">PDF, image, or Word — up to 10MB.</p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {docs.length > 0 && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileIcon size={15} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{doc.fileName}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {doc.uploadedBy === 'client' ? 'you' : 'your agent'}
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
      )}
    </section>
  );
}
