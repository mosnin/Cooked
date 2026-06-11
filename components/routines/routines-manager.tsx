'use client';

/**
 * RoutinesManager — the realtor's standing instructions for Chippi.
 *
 * A routine is a sentence and a time. This screen reads and writes them
 * through /api/routines; the hourly cron at /api/cron/routines is what
 * actually fires the autonomous run. Every run drafts — nothing is sent
 * without the realtor's approval.
 *
 * Times are stored as a UTC hour. The composer and the schedule labels
 * render that hour in the realtor's own browser timezone, so the cron
 * stays timezone-agnostic and the realtor never thinks about UTC.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Repeat2, Play, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CAPTION, PRIMARY_PILL } from '@/lib/typography';

type Cadence = 'hourly' | 'daily' | 'weekdays' | 'monthly' | 'custom';
type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface Routine {
  id: string;
  instruction: string;
  cadence: Cadence;
  hour: number;
  /** Set when cadence === 'monthly' (1-28). Null otherwise. */
  dayOfMonth: number | null;
  /** Set when cadence === 'custom'. Null otherwise. */
  daysOfWeek: Weekday[] | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: 'ok' | 'error' | null;
  nextRunAt: string;
  createdAt: string;
}

interface ComposerValue {
  instruction: string;
  cadence: Cadence;
  hour: number;
  dayOfMonth: number | null;
  daysOfWeek: Weekday[] | null;
}

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: 'mon', label: 'M' },
  { value: 'tue', label: 'T' },
  { value: 'wed', label: 'W' },
  { value: 'thu', label: 'T' },
  { value: 'fri', label: 'F' },
  { value: 'sat', label: 'S' },
  { value: 'sun', label: 'S' },
];

const WEEKDAY_LONG: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const MAX_DAY_OF_MONTH = 28;

const MIN_INSTRUCTION = 10;

// ── Time helpers — UTC hour in storage, local time on screen ─────────────────
//
// Reference date is *today*, not a fixed Jan-2020. Anchoring on a winter date
// inside a DST timezone (EST/EDT, BST/GMT, etc.) drifts the conversion by an
// hour for half the year — picking "9 AM" in May ends up firing at 10 AM.
// Using today's date binds the conversion to whichever DST regime the user
// is in right now, which is the only one they care about when they save.

function _todayAtUtcHour(utcHour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0));
}

function localHourLabel(utcHour: number): string {
  return _todayAtUtcHour(utcHour).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function scheduleLabel(
  cadence: Cadence,
  hour: number,
  dayOfMonth: number | null,
  daysOfWeek: Weekday[] | null,
): string {
  if (cadence === 'hourly') return 'Every hour';
  const at = ` at ${localHourLabel(hour)}`;
  if (cadence === 'weekdays') return `Every weekday${at}`;
  if (cadence === 'monthly') {
    const d = dayOfMonth ?? 1;
    const suffix = ordinalSuffix(d);
    return `The ${d}${suffix} of each month${at}`;
  }
  if (cadence === 'custom') {
    const days = daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : null;
    if (!days) return `Custom${at}`;
    const names = days.map((d) => WEEKDAY_LONG[d]).join(', ');
    return `${names}${at}`;
  }
  return `Every day${at}`;
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  const mod10 = n % 10;
  if (mod10 === 1) return 'st';
  if (mod10 === 2) return 'nd';
  if (mod10 === 3) return 'rd';
  return 'th';
}

/** The UTC hour that lands at 9:00 local *today* — a sane "morning" default. */
function defaultUtcHour(): number {
  for (let u = 0; u < 24; u++) {
    if (_todayAtUtcHour(u).getHours() === 9) return u;
  }
  return 13;
}

/** 24 hour options, valued by UTC hour, labelled + ordered by local time. */
function hourOptions(): { value: number; label: string }[] {
  return Array.from({ length: 24 }, (_, u) => {
    const d = _todayAtUtcHour(u);
    return { value: u, label: localHourLabel(u), sortKey: d.getHours() * 60 + d.getMinutes() };
  })
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ value, label }) => ({ value, label }));
}

function formatRelative(iso: string): string {
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return diffSec >= 0 ? 'in a moment' : 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

// ── Manager ──────────────────────────────────────────────────────────────────

export function RoutinesManager() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/routines');
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        if (!active) return;
        setRoutines(Array.isArray(data.routines) ? data.routines : []);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function createRoutine(payload: ComposerValue) {
    setBusyId('new');
    setActionError('');
    try {
      const res = await fetch('/api/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || 'Couldn’t create the routine.');
        return;
      }
      setRoutines((rs) => [...rs, data as Routine]);
      setComposerOpen(false);
    } catch {
      setActionError('Network hiccup. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function updateRoutine(id: string, payload: Partial<ComposerValue> & { enabled?: boolean }) {
    setBusyId(id);
    setActionError('');
    try {
      const res = await fetch(`/api/routines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || 'Couldn’t save the routine.');
        return;
      }
      setRoutines((rs) => rs.map((r) => (r.id === id ? (data as Routine) : r)));
      setEditingId(null);
    } catch {
      setActionError('Network hiccup. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleRoutine(routine: Routine) {
    const next = !routine.enabled;
    // Optimistic — the Switch should feel instant.
    setRoutines((rs) => rs.map((r) => (r.id === routine.id ? { ...r, enabled: next } : r)));
    setActionError('');
    try {
      const res = await fetch(`/api/routines/${routine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('toggle failed');
      const data = (await res.json()) as Routine;
      setRoutines((rs) => rs.map((r) => (r.id === routine.id ? data : r)));
    } catch {
      setRoutines((rs) =>
        rs.map((r) => (r.id === routine.id ? { ...r, enabled: routine.enabled } : r)),
      );
      setActionError('Couldn’t update the routine.');
    }
  }

  async function deleteRoutine(id: string) {
    setBusyId(id);
    setActionError('');
    try {
      const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      setRoutines((rs) => rs.filter((r) => r.id !== id));
      if (editingId === id) setEditingId(null);
    } catch {
      setActionError('Couldn’t delete the routine.');
    } finally {
      setBusyId(null);
    }
  }

  async function runNow(id: string) {
    setRunningId(id);
    setActionError('');
    try {
      const res = await fetch(`/api/routines/${id}`, { method: 'POST' });
      if (!res.ok && res.status !== 202) throw new Error('run failed');
      // Pull the refreshed run stamps so the card shows "Ran just now".
      const listRes = await fetch('/api/routines');
      if (listRes.ok) {
        const data = await listRes.json();
        if (Array.isArray(data.routines)) setRoutines(data.routines);
      }
    } catch {
      setActionError('Couldn’t start the routine.');
    } finally {
      setRunningId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
        <p className="text-sm text-foreground">Couldn’t load your routines.</p>
        <p className={cn(CAPTION, 'mt-1')}>Usually temporary — refresh to try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {/* The composer is an input surface — it stays a discrete card.
          The list below is a reading surface — it converts to divide-y
          rows. Different vocabularies for different jobs. */}
      {composerOpen ? (
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <RoutineComposer
            onSave={createRoutine}
            onCancel={() => {
              setComposerOpen(false);
              setActionError('');
            }}
            saving={busyId === 'new'}
          />
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setComposerOpen(true)}>
          <Plus size={14} />
          New routine
        </Button>
      )}

      {routines.length === 0 && !composerOpen ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing on a schedule yet. Set one up to give me a recurring beat.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              editing={editingId === routine.id}
              busy={busyId === routine.id}
              running={runningId === routine.id}
              onEdit={() => {
                setEditingId(routine.id);
                setActionError('');
              }}
              onCancelEdit={() => setEditingId(null)}
              onSave={(payload) => updateRoutine(routine.id, payload)}
              onToggle={() => toggleRoutine(routine)}
              onRunNow={() => runNow(routine.id)}
              onDelete={() => deleteRoutine(routine.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── One routine ──────────────────────────────────────────────────────────────

function RoutineRow({
  routine,
  editing,
  busy,
  running,
  onEdit,
  onCancelEdit,
  onSave,
  onToggle,
  onRunNow,
  onDelete,
}: {
  routine: Routine;
  editing: boolean;
  busy: boolean;
  running: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (payload: ComposerValue) => void;
  onToggle: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    // Editing flips this row back into a composer card — the same input
    // chrome the realtor saw when they wrote it. The list rhythm picks
    // up again above and below.
    return (
      <li className="py-3 first:pt-0">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <RoutineComposer
            initial={{
              instruction: routine.instruction,
              cadence: routine.cadence,
              hour: routine.hour,
              dayOfMonth: routine.dayOfMonth,
              daysOfWeek: routine.daysOfWeek,
            }}
            onSave={onSave}
            onCancel={onCancelEdit}
            saving={busy}
          />
        </div>
      </li>
    );
  }

  const failed = routine.lastRunStatus === 'error';
  const lastRun = routine.lastRunAt
    ? `${failed ? 'Last run failed' : 'Ran'} ${formatRelative(routine.lastRunAt)}`
    : null;

  return (
    <li
      className={cn(
        'group/row flex items-start gap-3 py-3 first:pt-0 transition-opacity',
        !routine.enabled && 'opacity-60',
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug text-foreground">{routine.instruction}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Repeat2 size={11} />
            {scheduleLabel(routine.cadence, routine.hour, routine.dayOfMonth, routine.daysOfWeek)}
          </span>
          {lastRun && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  failed && 'text-amber-600 dark:text-amber-500',
                )}
              >
                {failed && <AlertTriangle size={11} />}
                {lastRun}
              </span>
            </>
          )}
          {!routine.enabled && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>Paused</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {confirmingDelete ? (
          <>
            <span className="px-1 text-xs text-muted-foreground">Delete?</span>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-50"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              Delete
            </button>
          </>
        ) : (
          <>
            <Switch
              checked={routine.enabled}
              onCheckedChange={onToggle}
              aria-label={routine.enabled ? 'Pause routine' : 'Resume routine'}
            />
            {/* Run / edit / delete fade in on hover — same vocabulary as
                memory-list's delete button. Visible always on touch where
                there is no hover state. */}
            <RowAction icon={Play} label="Run now" onClick={onRunNow} loading={running} disabled={busy} />
            <RowAction icon={Pencil} label="Edit" onClick={onEdit} disabled={busy || running} />
            <RowAction
              icon={Trash2}
              label="Delete"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy || running}
              destructive
            />
          </>
        )}
      </div>
    </li>
  );
}

function RowAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  loading,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  destructive?: boolean;
}) {
  // Icon-only square button. Label lives in aria + title so screen readers
  // and hovering pointers still get the verb. Color is invisible by
  // default and fades in on row hover — same vocabulary as memory-list's
  // delete affordance.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      title={label}
      className={cn(
        'flex-shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md',
        'text-muted-foreground/0 group-hover/row:text-muted-foreground/70',
        'transition-colors disabled:opacity-50',
        destructive
          ? 'hover:text-destructive hover:bg-destructive/10'
          : 'hover:text-foreground hover:bg-foreground/[0.05]',
      )}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
    </button>
  );
}

// ── The sentence composer ────────────────────────────────────────────────────

function RoutineComposer({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ComposerValue;
  onSave: (payload: ComposerValue) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [instruction, setInstruction] = useState(initial?.instruction ?? '');
  const [cadence, setCadence] = useState<Cadence>(initial?.cadence ?? 'daily');
  const [hour, setHour] = useState<number>(initial?.hour ?? defaultUtcHour());
  const [dayOfMonth, setDayOfMonth] = useState<number>(initial?.dayOfMonth ?? 1);
  const [daysOfWeek, setDaysOfWeek] = useState<Weekday[]>(initial?.daysOfWeek ?? ['mon']);
  const [error, setError] = useState('');
  const hours = useMemo(() => hourOptions(), []);
  const dayOfMonthOptions = useMemo(
    () => Array.from({ length: MAX_DAY_OF_MONTH }, (_, i) => i + 1),
    [],
  );

  function toggleDay(day: Weekday) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  function submit() {
    const text = instruction.trim();
    if (text.length < MIN_INSTRUCTION) {
      setError('Write a full sentence — what should Chippi do?');
      return;
    }
    if (cadence === 'custom' && daysOfWeek.length === 0) {
      setError('Pick at least one day.');
      return;
    }
    setError('');
    onSave({
      instruction: text,
      cadence,
      hour,
      dayOfMonth: cadence === 'monthly' ? dayOfMonth : null,
      daysOfWeek: cadence === 'custom' ? daysOfWeek : null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label
          htmlFor="routine-instruction"
          className="text-[12.5px] font-medium text-foreground"
        >
          Chippi will…
        </Label>
        <Textarea
          id="routine-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Draft a check-in for every deal that’s gone quiet for two weeks."
          maxLength={600}
          rows={3}
          autoFocus
        />
      </div>

      <div className="space-y-2.5 text-[12.5px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Run this</span>
          <div className="inline-flex flex-wrap rounded-md border border-border/60 p-0.5">
            {CADENCE_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCadence(c.value)}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 font-medium transition-colors',
                  cadence === c.value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {cadence !== 'hourly' && (
          <div className="flex flex-wrap items-center gap-2">
            {cadence === 'monthly' && (
              <>
                <span className="text-muted-foreground">On the</span>
                <Select
                  value={String(dayOfMonth)}
                  onValueChange={(v) => setDayOfMonth(Number(v))}
                >
                  <SelectTrigger className="h-8 w-[5.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dayOfMonthOptions.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                        {ordinalSuffix(d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {cadence === 'custom' && (
              <div
                className="inline-flex rounded-md border border-border/60 p-0.5"
                role="group"
                aria-label="Days of the week"
              >
                {WEEKDAY_OPTIONS.map((d, i) => {
                  const selected = daysOfWeek.includes(d.value);
                  return (
                    <button
                      key={`${d.value}-${i}`}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      aria-pressed={selected}
                      aria-label={WEEKDAY_LONG[d.value]}
                      title={WEEKDAY_LONG[d.value]}
                      className={cn(
                        'inline-flex h-7 w-7 items-center justify-center rounded-[5px] font-medium transition-colors',
                        selected
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            )}

            <span className="text-muted-foreground">at</span>
            <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
              <SelectTrigger className="h-8 w-[7.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hours.map((h) => (
                  <SelectItem key={h.value} value={String(h.value)}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className={cn(PRIMARY_PILL, 'disabled:cursor-not-allowed disabled:opacity-60')}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Saving' : 'Save routine'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
