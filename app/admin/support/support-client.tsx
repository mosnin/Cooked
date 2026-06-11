'use client';

/**
 * Admin support center — triage every realtor help request.
 *
 * Structure mirrors announcement-client.tsx: a status filter strip, a table of
 * tickets, and a Dialog for the full message + inline triage (status, priority,
 * admin note). Optimistic on status flip; the detail dialog refetches the saved
 * row. Paper-flat, status pills from the canonical tone palette.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high';
export type TicketCategory = 'bug' | 'question' | 'billing' | 'feature' | 'other';

export type SupportTicket = {
  id: string;
  spaceId: string | null;
  userId: string;
  email: string;
  name: string | null;
  subject: string;
  message: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string | null;
};

type SpaceInfo = { name: string; slug: string };

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  in_progress: 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15',
  resolved: 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
  closed: 'text-muted-foreground bg-muted',
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  bug: 'Bug',
  question: 'Question',
  billing: 'Billing',
  feature: 'Feature',
  other: 'Other',
};

// Filter tabs — 'all' plus each status.
const FILTERS: { value: 'all' | TicketStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const ADMIN_NOTE_MAX = 5000;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Client ───────────────────────────────────────────────────────────────────

export function SupportClient({
  initialTickets,
  spaceMap,
}: {
  initialTickets: SupportTicket[];
  spaceMap: Record<string, SpaceInfo>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SupportTicket[]>(initialTickets);
  const [filter, setFilter] = useState<'all' | TicketStatus>('all');

  const [active, setActive] = useState<SupportTicket | null>(null);
  const [draftStatus, setDraftStatus] = useState<TicketStatus>('open');
  const [draftPriority, setDraftPriority] = useState<TicketPriority>('normal');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  const counts: Record<'all' | TicketStatus, number> = {
    all: rows.length,
    open: rows.filter((r) => r.status === 'open').length,
    in_progress: rows.filter((r) => r.status === 'in_progress').length,
    resolved: rows.filter((r) => r.status === 'resolved').length,
    closed: rows.filter((r) => r.status === 'closed').length,
  };

  function openTicket(t: SupportTicket) {
    setActive(t);
    setDraftStatus(t.status);
    setDraftPriority(t.priority);
    setDraftNote(t.adminNote ?? '');
    setErr(null);
  }

  async function handleSave() {
    if (!active) return;
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch('/api/admin/support', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: active.id,
          status: draftStatus,
          priority: draftPriority,
          adminNote: draftNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ticket) {
        setErr(data.error || 'Save failed.');
        return;
      }
      const saved: SupportTicket = data.ticket;
      setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      setActive(null);
      router.refresh();
    } catch {
      setErr('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Filter strip ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          );
        })}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={LifeBuoy}
            title="Nothing here. Quiet day."
            description="Help requests from realtors will land here for triage."
          />
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Submitter</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Space</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Category</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Subject</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Priority</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {visible.map((t) => {
                  const space = t.spaceId ? spaceMap[t.spaceId] : undefined;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="max-w-[200px]">
                          {t.name && <div className="font-medium truncate">{t.name}</div>}
                          <div className="text-muted-foreground truncate text-xs">{t.email}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                        {space ? space.name : '—'}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs">
                        {CATEGORY_LABELS[t.category]}
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[280px] truncate">{t.subject}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex text-xs font-medium rounded-full px-2.5 py-0.5 whitespace-nowrap',
                            STATUS_STYLES[t.status],
                          )}
                        >
                          {STATUS_LABELS[t.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground capitalize">
                        {PRIORITY_LABELS[t.priority]}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(t.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Detail / triage dialog ─────────────────────────────────────── */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle>{active.subject}</DialogTitle>
                <DialogDescription>
                  {active.name ? `${active.name} · ` : ''}
                  {active.email}
                  {active.spaceId && spaceMap[active.spaceId]
                    ? ` · ${spaceMap[active.spaceId].name}`
                    : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Full message */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Message
                  </p>
                  <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2.5 text-sm whitespace-pre-wrap break-words">
                    {active.message}
                  </div>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {CATEGORY_LABELS[active.category]} · submitted {formatDate(active.createdAt)}
                  </p>
                </div>

                {/* Triage controls */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Status</label>
                    <Select
                      value={draftStatus}
                      onValueChange={(v) => setDraftStatus(v as TicketStatus)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_LABELS) as TicketStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Priority</label>
                    <Select
                      value={draftPriority}
                      onValueChange={(v) => setDraftPriority(v as TicketPriority)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => (
                          <SelectItem key={p} value={p}>
                            {PRIORITY_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Internal note</label>
                  <Textarea
                    value={draftNote}
                    maxLength={ADMIN_NOTE_MAX}
                    onChange={(e) => setDraftNote(e.target.value)}
                    placeholder="Triage notes — not shown to the realtor."
                    rows={3}
                  />
                </div>

                {err && <p className="text-xs text-destructive">{err}</p>}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setActive(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
