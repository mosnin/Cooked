'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  UserPlus,
  UserMinus,
  Check,
  CalendarClock,
  Handshake,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
  Inbox,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatCompact, getInitials } from '@/lib/formatting';
import {
  BODY_MUTED,
  GHOST_PILL,
  PRIMARY_PILL,
  SECTION_LABEL,
} from '@/lib/typography';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  budget: number | null;
  scoreLabel: string | null;
  leadScore: number | null;
  leadType: 'rental' | 'buyer' | null;
  moveTiming: string | null;
  createdAt: string;
  assignedTo: string | null;
  assignedAt: string | null;
}

export interface AssignedLeadProgress {
  realtorName: string;
  assignedAt: string;
  assignedContactId: string;
  assignedSpaceId: string;
  currentStage: 'QUALIFICATION' | 'TOUR' | 'APPLICATION';
  currentScore: number | null;
  currentScoreLabel: string | null;
  lastActivityAt: string | null;
  hasFollowUp: boolean;
  followUpAt: string | null;
  hasDeal: boolean;
}

export interface RealtorOption {
  userId: string;
  name: string | null;
  email: string;
  spaceId: string | null;
  leadCount: number;
}

interface Props {
  unassignedLeads: LeadRow[];
  assignedLeads: LeadRow[];
  realtors: RealtorOption[];
  assignedLeadProgress?: Record<string, AssignedLeadProgress>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scorePill(label: string | null) {
  if (!label) return null;
  const l = label.toLowerCase();
  const className =
    l === 'hot'
      ? 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15'
      : l === 'warm'
        ? 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15'
        : l === 'cold'
          ? 'text-sky-700 bg-sky-50 dark:text-sky-400 dark:bg-sky-500/15'
          : 'text-muted-foreground bg-muted/60';
  return (
    <span
      className={cn(
        'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0',
        className,
      )}
    >
      {label}
    </span>
  );
}

function leadTypeLabel(leadType: 'rental' | 'buyer' | null) {
  if (!leadType) return null;
  return leadType === 'buyer' ? 'Buyer' : 'Rental';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function relativeTime(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function stagePill(stage: AssignedLeadProgress['currentStage']) {
  const styles: Record<string, string> = {
    QUALIFICATION: 'text-sky-700 bg-sky-50 dark:text-sky-400 dark:bg-sky-500/15',
    TOUR: 'text-violet-700 bg-violet-50 dark:text-violet-400 dark:bg-violet-500/15',
    APPLICATION:
      'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
  };
  const labels: Record<string, string> = {
    QUALIFICATION: 'Qualifying',
    TOUR: 'Tour',
    APPLICATION: 'Applied',
  };
  return (
    <span
      className={cn(
        'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0',
        styles[stage] ?? 'text-muted-foreground bg-muted/60',
      )}
    >
      {labels[stage] ?? stage}
    </span>
  );
}

// ── Realtor picker popover ────────────────────────────────────────────────────

function RealtorPicker({
  realtors,
  onSelect,
  disabled,
}: {
  realtors: RealtorOption[];
  onSelect: (r: RealtorOption) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return realtors;
    const q = search.toLowerCase();
    return realtors.filter(
      (r) =>
        (r.name ?? '').toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q),
    );
  }, [realtors, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            PRIMARY_PILL,
            'h-8 px-3 text-xs disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          <UserPlus size={12} />
          Route
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border/60 px-2 py-1.5">
          <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50">
            <Search size={13} className="text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              placeholder="Find a realtor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground text-center">
              No realtors match.
            </p>
          ) : (
            filtered.map((r) => (
              <button
                key={r.userId}
                type="button"
                onClick={() => {
                  onSelect(r);
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                  {getInitials(r.name ?? r.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.name ?? r.email}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{r.email}</p>
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                  {r.leadCount}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Lead notes ────────────────────────────────────────────────────────────────

function LeadNotes({ contactId }: { contactId: string }) {
  const [notes, setNotes] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadNotes = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await fetch(`/api/broker/lead-note?contactId=${contactId}`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes ?? '');
      }
    } catch {
      // Silently fail
    } finally {
      setLoaded(true);
    }
  }, [contactId, loaded]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  async function handleAddNote(noteText: string) {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/broker/lead-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, note: noteText.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "I couldn't save that note.");
      }
      const data = await res.json();
      setNotes(data.updatedNotes);
      if (textareaRef.current) textareaRef.current.value = '';
      toast.success('Note saved.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "I couldn't save that note.");
    } finally {
      setSaving(false);
    }
  }

  const noteEntries = notes.split(/\n\n/).filter((n) => n.trim()).slice(0, 10);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          placeholder="Add a note…"
          rows={2}
          className="flex-1 rounded-md border border-border/70 bg-background px-3 py-2 text-xs resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAddNote(e.currentTarget.value);
            }
          }}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            if (textareaRef.current) handleAddNote(textareaRef.current.value);
          }}
          className={cn(PRIMARY_PILL, 'self-end h-8 px-3 text-xs disabled:opacity-50')}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">⌘+Enter to save</p>

      {noteEntries.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {noteEntries.map((entry, i) => (
            <div
              key={i}
              className="text-xs text-muted-foreground bg-muted/40 rounded px-2.5 py-1.5 whitespace-pre-wrap"
            >
              {entry}
            </div>
          ))}
        </div>
      )}
      {loaded && noteEntries.length === 0 && (
        <p className="text-[11px] text-muted-foreground/60 italic">No notes yet.</p>
      )}
    </div>
  );
}

// ── Unassigned row ────────────────────────────────────────────────────────────

function UnassignedRow({
  lead,
  realtors,
  onAssigned,
  onDeleted,
}: {
  lead: LeadRow;
  realtors: RealtorOption[];
  onAssigned: (leadId: string, realtor: RealtorOption) => void;
  onDeleted: (leadId: string) => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/broker/leads/${lead.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("I couldn't delete that lead.");
      toast.success('Lead deleted.');
      onDeleted(lead.id);
    } catch {
      toast.error("I couldn't delete that lead.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleAssign(realtor: RealtorOption) {
    setAssigning(true);
    try {
      const res = await fetch('/api/broker/assign-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: lead.id, realtorUserId: realtor.userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "I couldn't route that lead.");
      }
      toast.success(`Routed to ${realtor.name ?? realtor.email}.`);
      onAssigned(lead.id, realtor);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "I couldn't route that lead.");
    } finally {
      setAssigning(false);
    }
  }

  const typeLabel = leadTypeLabel(lead.leadType);

  return (
    <li>
      <div className="group/row flex items-center gap-3 py-3 px-2 -mx-2 rounded-md hover:bg-muted/30 transition-colors">
        <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
          {getInitials(lead.name || lead.email || '?')}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {lead.name || 'Unnamed'}
            </span>
            {scorePill(lead.scoreLabel)}
            {typeLabel && (
              <span className="text-[10px] font-medium text-muted-foreground/80 flex-shrink-0">
                {typeLabel}
              </span>
            )}
          </div>
          {(lead.email || lead.phone || lead.budget != null) && (
            <div className="mt-0.5 text-xs text-muted-foreground truncate">
              {lead.email && <span>{lead.email}</span>}
              {lead.email && lead.phone && (
                <span className="text-muted-foreground/40"> · </span>
              )}
              {lead.phone && <span className="tabular-nums">{lead.phone}</span>}
              {(lead.email || lead.phone) && lead.budget != null && (
                <span className="text-muted-foreground/40"> · </span>
              )}
              {lead.budget != null && (
                <span className="tabular-nums">{formatCompact(lead.budget)}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="hidden sm:inline text-[11px] text-muted-foreground tabular-nums">
            {relativeTime(lead.createdAt)}
          </span>
          <button
            type="button"
            onClick={() => setShowNotes(!showNotes)}
            aria-label="Toggle notes"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <MessageSquare size={13} />
          </button>
          <RealtorPicker realtors={realtors} onSelect={handleAssign} disabled={assigning} />
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 h-7 text-[11px] font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting ? '…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 h-7 text-[11px] font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete ${lead.name}`}
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-opacity opacity-0 group-hover/row:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {showNotes && (
        <div className="pb-3 pl-[calc(32px+0.75rem)]">
          <div className="rounded-lg bg-muted/30 border border-border/60 p-3">
            <LeadNotes contactId={lead.id} />
          </div>
        </div>
      )}
    </li>
  );
}

// ── Assigned row ──────────────────────────────────────────────────────────────

function AssignedRow({
  lead,
  progress,
  onUnassigned,
}: {
  lead: LeadRow;
  progress?: AssignedLeadProgress;
  onUnassigned?: (leadId: string, realtorName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unassigning, setUnassigning] = useState(false);

  const realtorName = progress?.realtorName ?? lead.assignedTo ?? 'this realtor';

  async function handleUnassign() {
    setUnassigning(true);
    try {
      const res = await fetch('/api/broker/unassign-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: lead.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "I couldn't pull that lead back.");
      }
      toast.success(`Pulled back from ${realtorName}.`);
      setConfirmOpen(false);
      onUnassigned?.(lead.id, realtorName);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "I couldn't pull that lead back.");
    } finally {
      setUnassigning(false);
    }
  }

  const canExpand = !!progress;
  const typeLabel = leadTypeLabel(lead.leadType);

  return (
    <li>
      <div
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={() => canExpand && setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className={cn(
          'group/row flex items-center gap-3 py-3 px-2 -mx-2 rounded-md transition-colors',
          canExpand ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/30',
        )}
      >
        <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
          {getInitials(lead.name || lead.email || '?')}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {lead.name || 'Unnamed'}
            </span>
            {progress ? stagePill(progress.currentStage) : scorePill(lead.scoreLabel)}
            {progress?.hasDeal && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15 flex-shrink-0">
                <Handshake size={9} />
                Deal
              </span>
            )}
            {typeLabel && (
              <span className="text-[10px] font-medium text-muted-foreground/80 flex-shrink-0">
                {typeLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground truncate flex items-center gap-1.5">
            <Check size={10} className="text-emerald-600 flex-shrink-0" />
            <span className="truncate">{realtorName}</span>
            {progress?.lastActivityAt && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <Clock size={10} className="flex-shrink-0" />
                <span>{relativeTime(progress.lastActivityAt)}</span>
              </>
            )}
            {progress?.hasFollowUp && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <CalendarClock size={10} className="text-amber-600 flex-shrink-0" />
                <span className="text-amber-700 dark:text-amber-400">Follow-up set</span>
              </>
            )}
            {!progress && lead.assignedAt && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>Routed {formatDate(lead.assignedAt)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!progress && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowNotes(!showNotes);
              }}
              aria-label="Toggle notes"
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <MessageSquare size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            disabled={unassigning}
            className={cn(
              GHOST_PILL,
              'h-8 px-3 text-xs hover:text-destructive disabled:opacity-50 disabled:pointer-events-none',
            )}
            title="Pull back"
          >
            <UserMinus size={12} />
            <span className="hidden sm:inline">Pull back</span>
          </button>
          {canExpand && (
            <ChevronDown
              size={14}
              className={cn(
                'text-muted-foreground/60 transition-transform flex-shrink-0',
                expanded && 'rotate-180',
              )}
            />
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pull this lead back?</DialogTitle>
            <DialogDescription>
              {lead.name || 'This lead'} comes off {realtorName}&rsquo;s plate and lands back in the unassigned queue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={unassigning}
              className={cn(GHOST_PILL, 'disabled:opacity-50')}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUnassign}
              disabled={unassigning}
              className={cn(PRIMARY_PILL, 'disabled:opacity-50')}
            >
              {unassigning ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
              Pull back
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {expanded && progress && (
        <div className="pb-3 pl-[calc(32px+0.75rem)]">
          <div className="rounded-lg bg-muted/30 border border-border/60 p-3 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className={SECTION_LABEL}>Realtor</p>
                <p className="mt-0.5 font-medium text-foreground">{progress.realtorName}</p>
              </div>
              <div>
                <p className={SECTION_LABEL}>Stage</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {progress.currentStage.charAt(0) + progress.currentStage.slice(1).toLowerCase()}
                </p>
              </div>
              <div>
                <p className={SECTION_LABEL}>Score</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {progress.currentScore != null ? progress.currentScore : '—'}
                  {progress.currentScoreLabel && (
                    <span className="ml-1 text-muted-foreground font-normal">
                      ({progress.currentScoreLabel})
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className={SECTION_LABEL}>Routed</p>
                <p className="mt-0.5 font-medium text-foreground">{formatDate(progress.assignedAt)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className={SECTION_LABEL}>Last activity</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {progress.lastActivityAt ? relativeTime(progress.lastActivityAt) : 'Nothing yet'}
                </p>
              </div>
              <div>
                <p className={SECTION_LABEL}>Follow-up</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {progress.followUpAt ? formatDate(progress.followUpAt) : 'None scheduled'}
                </p>
              </div>
              <div>
                <p className={SECTION_LABEL}>Deal</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {progress.hasDeal ? 'Open' : 'None'}
                </p>
              </div>
            </div>

            <div className="border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowNotes(!showNotes);
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <MessageSquare size={12} />
                Notes
                {showNotes ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              {showNotes && <LeadNotes contactId={lead.id} />}
            </div>
          </div>
        </div>
      )}

      {showNotes && !progress && (
        <div className="pb-3 pl-[calc(32px+0.75rem)]">
          <div className="rounded-lg bg-muted/30 border border-border/60 p-3">
            <LeadNotes contactId={lead.id} />
          </div>
        </div>
      )}
    </li>
  );
}

// ── Section header — SECTION_LABEL with count and optional hint ───────────────

function SectionHeader({
  label,
  count,
  hint,
}: {
  label: string;
  count: number;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 pb-3 border-b border-border/60">
      <h2 className={SECTION_LABEL}>{label}</h2>
      <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
      {hint && <span className="ml-auto text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BrokerLeadsClient({
  unassignedLeads,
  assignedLeads,
  realtors,
  assignedLeadProgress = {},
}: Props) {
  const [unassigned, setUnassigned] = useState(unassignedLeads);
  const [assigned, setAssigned] = useState(assignedLeads);
  const [search, setSearch] = useState('');
  const [realtorFilter, setRealtorFilter] = useState<string>('all');

  // Resolve the realtor a routed lead sits with — same rule AssignedRow uses
  // (live progress wins, falls back to the assignment label).
  const realtorOf = useCallback(
    (lead: LeadRow) => assignedLeadProgress[lead.id]?.realtorName ?? lead.assignedTo ?? null,
    [assignedLeadProgress],
  );

  // Realtors who actually have routed leads, plus any team member — so the
  // menu mirrors the team even before everyone has a lead. Sorted, deduped.
  const realtorNames = useMemo(() => {
    const set = new Set<string>();
    for (const lead of assigned) {
      const name = realtorOf(lead);
      if (name) set.add(name);
    }
    for (const r of realtors) {
      const name = r.name ?? r.email;
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [assigned, realtors, realtorOf]);

  const applySearch = useCallback(
    (list: LeadRow[]) => {
      const q = search.trim().toLowerCase();
      if (!q) return list;
      return list.filter(
        (l) =>
          l.name?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.phone?.toLowerCase().includes(q),
      );
    },
    [search],
  );

  const filteredUnassigned = useMemo(() => {
    // A specific realtor has no claim on unassigned leads — hide them.
    if (realtorFilter !== 'all') return [];
    return applySearch(unassigned);
  }, [unassigned, applySearch, realtorFilter]);

  const filteredAssigned = useMemo(() => {
    const byRealtor =
      realtorFilter === 'all'
        ? assigned
        : assigned.filter((l) => realtorOf(l) === realtorFilter);
    return applySearch(byRealtor);
  }, [assigned, applySearch, realtorFilter, realtorOf]);

  function handleAssigned(leadId: string, realtor: RealtorOption) {
    const lead = unassigned.find((l) => l.id === leadId);
    if (!lead) return;
    setUnassigned((prev) => prev.filter((l) => l.id !== leadId));
    setAssigned((prev) => [
      {
        ...lead,
        assignedTo: realtor.name ?? realtor.email,
        assignedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  function handleUnassigned(leadId: string) {
    const lead = assigned.find((l) => l.id === leadId);
    if (!lead) return;
    setAssigned((prev) => prev.filter((l) => l.id !== leadId));
    setUnassigned((prev) => [
      { ...lead, assignedTo: null, assignedAt: null },
      ...prev,
    ]);
  }

  const hasAnyLeads = unassigned.length > 0 || assigned.length > 0;
  const isSearching = !!search.trim();

  return (
    <div className="space-y-8 pb-56 md:pb-24">
      {/* Search + by-realtor filter — the only chrome. View toggles, sort
          dropdown, lead type filter, score pills, and "Add Lead" button all
          cut. Brokers don't manually add leads; intake forms do. */}
      {hasAnyLeads && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative w-full sm:w-80">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              placeholder="Search by name, email, or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border/70 bg-background pl-9 pr-3 h-9 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {realtorNames.length > 1 && (
            <Select value={realtorFilter} onValueChange={setRealtorFilter}>
              <SelectTrigger
                className="w-full sm:w-[200px]"
                aria-label="Filter by realtor"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All realtors</SelectItem>
                {realtorNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Fresh-brokerage empty state — no leads at all. Canonical dashed card,
          one sentence, first-person Chippi voice. */}
      {!hasAnyLeads && (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <Inbox size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
          <p className="text-base text-foreground">No leads yet.</p>
          <p className={cn(BODY_MUTED, 'mt-1.5')}>
            Your intake form will land them here — I&rsquo;ll route them to your team.
          </p>
        </div>
      )}

      {/* Unassigned — the one demanding routing. Shown first so it's the
          first thing the broker reaches for. Hidden when filtering to a
          single realtor: unassigned leads belong to no one, so an empty
          queue under a realtor filter is noise. */}
      {hasAnyLeads && realtorFilter === 'all' && (
        <section className="space-y-2">
          <SectionHeader
            label="Unassigned"
            count={filteredUnassigned.length}
            hint={filteredUnassigned.length > 0 ? 'Route to a realtor' : undefined}
          />
          {filteredUnassigned.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
              <p className="text-sm text-foreground">
                {isSearching
                  ? 'No matches in the unassigned queue.'
                  : "Caught up. Every lead is on someone's plate."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filteredUnassigned.map((lead) => (
                <UnassignedRow
                  key={lead.id}
                  lead={lead}
                  realtors={realtors}
                  onAssigned={handleAssigned}
                  onDeleted={(id) =>
                    setUnassigned((prev) => prev.filter((l) => l.id !== id))
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Routed — what your team is working on. Quieter section. */}
      {hasAnyLeads && (
        <section className="space-y-2">
          <SectionHeader label="Routed" count={filteredAssigned.length} />
          {filteredAssigned.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
              <p className="text-sm text-foreground">
                {isSearching
                  ? 'No matches in the routed list.'
                  : realtorFilter !== 'all'
                    ? `Nothing on ${realtorFilter}’s plate yet.`
                    : "Nothing on a realtor's plate yet."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filteredAssigned.map((lead) => (
                <AssignedRow
                  key={lead.id}
                  lead={lead}
                  progress={assignedLeadProgress[lead.id]}
                  onUnassigned={handleUnassigned}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
