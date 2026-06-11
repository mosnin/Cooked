'use client';

/**
 * SendForSignature — embedded control to send one stored document out for
 * signature on the realtor's OWN connected DocuSign account (via Composio).
 *
 * Two embeds share it:
 *   - Per-document row on the deal Documents tab (`documentId` fixed).
 *   - Person record (`documents` list to pick from; signer prefilled).
 *
 * It renders one of three states inline:
 *   - DocuSign not connected → a quiet "Connect DocuSign" link to settings.
 *   - A request already out for this document → a status pill (+ refresh).
 *   - Otherwise → a "Send for signature" button that opens a small form.
 *
 * Design (Jobs lens): one action, calm copy, the canonical pill palette.
 * No emoji. Sentence case. The pill is the focal note once something's out.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PenLine, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import { cn } from '@/lib/utils';

export type SignatureStatus =
  | 'created'
  | 'sent'
  | 'delivered'
  | 'completed'
  | 'declined'
  | 'voided';

export interface SignatureRequestLite {
  id: string;
  documentId: string | null;
  status: SignatureStatus;
  signerEmail: string;
  signerName: string | null;
  subject: string;
  createdAt: string;
}

interface DocumentChoice {
  id: string;
  label: string;
}

interface SendForSignatureProps {
  /** Workspace slug — authorizes the send and the status refresh. */
  slug: string;
  /** True when the realtor has DocuSign connected (server-resolved). */
  connected: boolean;
  /** Fixed document to send (deal doc row). Omit to let the realtor pick. */
  documentId?: string;
  documentLabel?: string;
  /** Documents to choose from (person record). Ignored when documentId set. */
  documents?: DocumentChoice[];
  dealId?: string;
  contactId?: string;
  /** Prefill the signer (e.g. the contact's email/name). */
  defaultSignerEmail?: string;
  defaultSignerName?: string;
  /** An existing request for this document, if any — renders as a pill. */
  initialRequest?: SignatureRequestLite | null;
  /** Compact trigger — quieter, for inline doc rows. */
  compact?: boolean;
}

const PILL_LABEL: Record<SignatureStatus, string> = {
  created: 'Draft',
  sent: 'Sent',
  delivered: 'Viewed',
  completed: 'Signed',
  declined: 'Declined',
  voided: 'Voided',
};

const PILL_CLASS: Record<SignatureStatus, string> = {
  created: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  delivered: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  declined: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  voided: 'bg-muted text-muted-foreground line-through',
};

const TERMINAL = new Set<SignatureStatus>(['completed', 'declined', 'voided']);

function StatusPill({ status }: { status: SignatureStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        PILL_CLASS[status],
      )}
    >
      {PILL_LABEL[status]}
    </span>
  );
}

export function SendForSignature({
  slug,
  connected,
  documentId,
  documentLabel,
  documents = [],
  dealId,
  contactId,
  defaultSignerEmail,
  defaultSignerName,
  initialRequest = null,
  compact = false,
}: SendForSignatureProps) {
  const [request, setRequest] = useState<SignatureRequestLite | null>(initialRequest);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [pickedDocId, setPickedDocId] = useState<string>(documentId ?? documents[0]?.id ?? '');
  const [signerEmail, setSignerEmail] = useState(defaultSignerEmail ?? '');
  const [signerName, setSignerName] = useState(defaultSignerName ?? '');
  const [subject, setSubject] = useState(
    documentLabel ? `Please sign: ${documentLabel}` : 'Please sign this document',
  );

  // Refresh any non-terminal request on mount so the pill is current.
  const refresh = useCallback(async () => {
    if (!request || TERMINAL.has(request.status)) return;
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/esign/${request.id}?slug=${encodeURIComponent(slug)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { request?: SignatureRequestLite | null };
      if (data.request) setRequest(data.request);
    } catch {
      // Quiet — a refresh miss just leaves the last-known status showing.
    } finally {
      setRefreshing(false);
    }
  }, [request, slug]);

  useEffect(() => {
    void refresh();
    // Only on mount — the manual refresh button covers re-checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = async () => {
    const email = signerEmail.trim();
    const docId = documentId ?? pickedDocId;
    if (!docId) {
      toastError('Pick a document to send.');
      return;
    }
    if (!email) {
      toastError("Add the signer's email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/esign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          documentId: docId,
          dealId,
          contactId,
          signerEmail: email,
          signerName: signerName.trim() || undefined,
          subject: subject.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; request?: SignatureRequestLite };
      if (!res.ok) {
        toastError(data.error ?? 'Could not send for signature. Try again.');
        return;
      }
      if (data.request) setRequest(data.request);
      toastSuccess(`Sent for signature — ${email}.`);
      setOpen(false);
    } catch {
      toastError('Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Not connected → quiet connect link, never an error.
  if (!connected) {
    return (
      <Link
        href={`/s/${slug}/settings?tab=integrations`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <PenLine size={13} strokeWidth={1.75} />
        Connect DocuSign
      </Link>
    );
  }

  // A request is out → show the pill (+ a quiet refresh for non-terminal).
  if (request) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <StatusPill status={request.status} />
        {!TERMINAL.has(request.status) && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh status"
            aria-label="Refresh signature status"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} />
          </button>
        )}
      </span>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(compact && 'h-7 px-2 text-xs')}
      >
        <PenLine size={compact ? 13 : 14} strokeWidth={1.75} />
        Send for signature
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send for signature</DialogTitle>
            <DialogDescription>
              We&apos;ll send it from your connected DocuSign. You&apos;ll see the status here as
              they sign.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!documentId && documents.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="esign-doc">Document</Label>
                <select
                  id="esign-doc"
                  value={pickedDocId}
                  onChange={(e) => setPickedDocId(e.target.value)}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-card"
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="esign-email">Signer email</Label>
              <Input
                id="esign-email"
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="esign-name">Signer name</Label>
              <Input
                id="esign-name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="esign-subject">Subject</Label>
              <Input
                id="esign-subject"
                value={subject}
                maxLength={200}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Please sign this document"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSend} disabled={submitting}>
              {submitting ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
