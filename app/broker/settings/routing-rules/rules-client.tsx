'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  CAPTION,
  PRIMARY_PILL,
  GHOST_PILL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { DealRoutingRuleRow } from '@/lib/routing-rule-schema';

// ── Types ─────────────────────────────────────────────────────────────────────

type FallbackMethod = 'manual' | 'round_robin' | 'score_based';
type PoolMethod = 'round_robin' | 'score_based';
type DestinationKind = 'agent' | 'pool';
type LeadTypeOption = 'any' | 'buyer' | 'rental';

type BrokerageMember = {
  userId: string;
  role: string;
  name: string | null;
  email: string;
};

type EditorMode = { kind: 'create' } | { kind: 'edit'; rule: DealRoutingRuleRow };

type EditorForm = {
  name: string;
  priority: string;
  enabled: boolean;
  leadType: LeadTypeOption;
  minBudget: string;
  maxBudget: string;
  matchTag: string;
  destinationKind: DestinationKind;
  destinationUserId: string;
  destinationPoolMethod: PoolMethod;
  destinationPoolTag: string;
};

type FieldError = Partial<Record<keyof EditorForm, string>>;

const METHOD_LABEL: Record<FallbackMethod, string> = {
  manual: 'Manual',
  round_robin: 'Round-robin',
  score_based: 'Score-based',
};

// ── Root client component ─────────────────────────────────────────────────────

export default function RulesClient({
  initialRules,
  members,
  fallbackMethod,
  canEdit,
}: {
  initialRules: DealRoutingRuleRow[];
  members: BrokerageMember[];
  fallbackMethod: FallbackMethod;
  canEdit: boolean;
}) {
  const [rules, setRules] = useState<DealRoutingRuleRow[]>(initialRules);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const memberById = useMemo(() => {
    const m = new Map<string, BrokerageMember>();
    for (const mem of members) m.set(mem.userId, mem);
    return m;
  }, [members]);

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
  }, [rules]);

  const reloadList = useCallback(async () => {
    try {
      const res = await fetch('/api/broker/routing-rules', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as DealRoutingRuleRow[];
        setRules(data);
      }
    } catch {
      // Silent — the last-known state stays on screen.
    }
  }, []);

  const handleToggleEnabled = useCallback(
    async (rule: DealRoutingRuleRow) => {
      if (!canEdit) return;
      setTogglingId(rule.id);
      try {
        const res = await fetch(`/api/broker/routing-rules/${rule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !rule.enabled }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(data.error ?? 'Failed to toggle.');
          return;
        }
        await reloadList();
      } catch {
        toast.error('Network error.');
      } finally {
        setTogglingId(null);
      }
    },
    [canEdit, reloadList],
  );

  const handleDelete = useCallback(
    async (rule: DealRoutingRuleRow) => {
      if (!canEdit) return;
      if (!confirm(`Delete rule "${rule.name}"?`)) return;
      setDeleting(rule.id);
      try {
        const res = await fetch(`/api/broker/routing-rules/${rule.id}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 204) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(data.error ?? 'Failed to delete.');
          return;
        }
        toast.success('Rule deleted.');
        await reloadList();
      } catch {
        toast.error('Network error.');
      } finally {
        setDeleting(null);
      }
    },
    [canEdit, reloadList],
  );

  const handleReorder = useCallback(
    async (rule: DealRoutingRuleRow, direction: 'up' | 'down') => {
      if (!canEdit) return;
      const delta = direction === 'up' ? -1 : 1;
      const newPriority = Math.max(0, Math.min(10000, rule.priority + delta));
      if (newPriority === rule.priority) return;
      setReordering(rule.id);
      try {
        const res = await fetch(`/api/broker/routing-rules/${rule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: newPriority }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(data.error ?? 'Failed to reorder.');
          return;
        }
        await reloadList();
      } catch {
        toast.error('Network error.');
      } finally {
        setReordering(null);
      }
    },
    [canEdit, reloadList],
  );

  const subtitle =
    sortedRules.length === 0
      ? `No rules yet. Falling back to ${METHOD_LABEL[fallbackMethod].toLowerCase()}.`
      : `${sortedRules.length} rule${sortedRules.length === 1 ? '' : 's'}. ${METHOD_LABEL[fallbackMethod]} handles the rest.`;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <p className={BODY_MUTED}>Settings.</p>
          <h1 className={H1} style={TITLE_FONT}>
            Routing rules
          </h1>
          <p className={BODY_MUTED}>{subtitle}</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditor({ kind: 'create' })}
            className={cn(PRIMARY_PILL, 'shrink-0')}
          >
            <Plus size={13} />
            Add rule
          </button>
        )}
      </header>

      {sortedRules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">No routing rules yet.</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Add one when a specific kind of lead should always go to a specific agent.
            Otherwise{' '}
            <span className="font-medium text-foreground">
              {METHOD_LABEL[fallbackMethod].toLowerCase()}
            </span>{' '}
            handles every lead.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {sortedRules.map((rule, idx) => (
            <li key={rule.id} className="flex items-start gap-3 py-3">
              <div className="flex flex-col items-center gap-0.5 pt-0.5">
                <button
                  type="button"
                  disabled={!canEdit || idx === 0 || reordering === rule.id}
                  onClick={() => handleReorder(rule, 'up')}
                  title="Raise priority"
                  className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <ArrowUp size={12} />
                </button>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {rule.priority}
                </span>
                <button
                  type="button"
                  disabled={!canEdit || idx === sortedRules.length - 1 || reordering === rule.id}
                  onClick={() => handleReorder(rule, 'down')}
                  title="Lower priority"
                  className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <ArrowDown size={12} />
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">
                    {rule.name}
                  </p>
                  {!rule.enabled && (
                    <span className="inline-flex text-[11px] font-medium rounded-full px-2 py-0.5 bg-muted text-muted-foreground">
                      Paused
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {summarizeRule(rule, memberById)}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={() => handleToggleEnabled(rule)}
                  disabled={!canEdit || togglingId === rule.id}
                  aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                />
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditor({ kind: 'edit', rule })}
                      title="Edit rule"
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={deleting === rule.id}
                      onClick={() => handleDelete(rule)}
                      title="Delete rule"
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-foreground/[0.04] transition-colors disabled:opacity-60"
                    >
                      {deleting === rule.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <RuleEditorDialog
          mode={editor}
          members={members}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await reloadList();
          }}
        />
      )}
    </div>
  );
}

// ── Editor dialog ─────────────────────────────────────────────────────────────

function RuleEditorDialog({
  mode,
  members,
  onClose,
  onSaved,
}: {
  mode: EditorMode;
  members: BrokerageMember[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const initialForm = useMemo<EditorForm>(() => {
    if (mode.kind === 'create') {
      return {
        name: '',
        priority: '100',
        enabled: true,
        leadType: 'any',
        minBudget: '',
        maxBudget: '',
        matchTag: '',
        destinationKind: 'agent',
        destinationUserId: '',
        destinationPoolMethod: 'round_robin',
        destinationPoolTag: '',
      };
    }
    const r = mode.rule;
    return {
      name: r.name,
      priority: String(r.priority),
      enabled: r.enabled,
      leadType:
        r.leadType === 'buyer' || r.leadType === 'rental' ? r.leadType : 'any',
      minBudget: r.minBudget === null ? '' : String(r.minBudget),
      maxBudget: r.maxBudget === null ? '' : String(r.maxBudget),
      matchTag: r.matchTag ?? '',
      destinationKind: r.destinationUserId ? 'agent' : 'pool',
      destinationUserId: r.destinationUserId ?? '',
      destinationPoolMethod: r.destinationPoolMethod ?? 'round_robin',
      destinationPoolTag: r.destinationPoolTag ?? '',
    };
  }, [mode]);

  const [form, setForm] = useState<EditorForm>(initialForm);
  const [errors, setErrors] = useState<FieldError>({});
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = useCallback((): { ok: boolean; errs: FieldError } => {
    const errs: FieldError = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    else if (form.name.trim().length > 100) errs.name = 'Max 100 characters.';

    const priorityNum = Number(form.priority);
    if (!Number.isFinite(priorityNum) || !Number.isInteger(priorityNum)) {
      errs.priority = 'Priority must be a whole number.';
    } else if (priorityNum < 0 || priorityNum > 10000) {
      errs.priority = 'Priority must be between 0 and 10000.';
    }

    let minNum: number | null = null;
    let maxNum: number | null = null;
    if (form.minBudget.trim() !== '') {
      const n = Number(form.minBudget);
      if (!Number.isFinite(n) || n < 0) errs.minBudget = 'Must be a non-negative number.';
      else minNum = n;
    }
    if (form.maxBudget.trim() !== '') {
      const n = Number(form.maxBudget);
      if (!Number.isFinite(n) || n < 0) errs.maxBudget = 'Must be a non-negative number.';
      else maxNum = n;
    }
    if (minNum !== null && maxNum !== null && maxNum < minNum) {
      errs.maxBudget = 'Max budget must be greater than or equal to min budget.';
    }

    if (form.matchTag.trim().length > 60) {
      errs.matchTag = 'Tags are at most 60 characters.';
    }

    if (form.destinationKind === 'agent') {
      if (!form.destinationUserId) errs.destinationUserId = 'Choose an agent.';
    } else {
      if (form.destinationPoolTag.trim().length > 60) {
        errs.destinationPoolTag = 'Tags are at most 60 characters.';
      }
    }

    return { ok: Object.keys(errs).length === 0, errs };
  }, [form]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { ok, errs } = validate();
    setErrors(errs);
    if (!ok) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        priority: Number(form.priority),
        enabled: form.enabled,
        leadType: form.leadType === 'any' ? null : form.leadType,
        minBudget: form.minBudget.trim() === '' ? null : Number(form.minBudget),
        maxBudget: form.maxBudget.trim() === '' ? null : Number(form.maxBudget),
        matchTag: form.matchTag.trim() === '' ? null : form.matchTag.trim(),
        destinationUserId:
          form.destinationKind === 'agent' ? form.destinationUserId : null,
        destinationPoolMethod:
          form.destinationKind === 'pool' ? form.destinationPoolMethod : null,
        destinationPoolTag:
          form.destinationKind === 'pool' && form.destinationPoolTag.trim() !== ''
            ? form.destinationPoolTag.trim()
            : null,
      };

      const isEdit = mode.kind === 'edit';
      const res = await fetch(
        isEdit ? `/api/broker/routing-rules/${mode.rule.id}` : '/api/broker/routing-rules',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: Array<{ path: unknown[]; message: string }>;
        };
        if (data.issues) {
          const fieldErrs: FieldError = {};
          for (const issue of data.issues) {
            const key = Array.isArray(issue.path) ? String(issue.path[0] ?? '') : '';
            if (key && key in form) {
              (fieldErrs as Record<string, string>)[key] = issue.message;
            }
          }
          setErrors(fieldErrs);
        }
        toast.error(data.error ?? 'Failed to save rule.');
        return;
      }

      toast.success(isEdit ? 'Rule updated.' : 'Rule created.');
      await onSaved();
    } catch {
      toast.error('Network error.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === 'create' ? 'Add routing rule' : 'Edit routing rule'}
          </DialogTitle>
          <DialogDescription>
            Criteria are AND-combined. Leave everything blank to make a catch-all.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={form.name}
              maxLength={100}
              placeholder="Rental inquiries → Sam"
              onChange={(e) => update('name', e.target.value)}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rule-priority">Priority</Label>
              <Input
                id="rule-priority"
                type="number"
                min={0}
                max={10000}
                value={form.priority}
                onChange={(e) => update('priority', e.target.value)}
              />
              {errors.priority ? (
                <p className="text-xs text-destructive">{errors.priority}</p>
              ) : (
                <p className={CAPTION}>Lower number runs first (0–10000).</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Enabled</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => update('enabled', v)}
                />
                <span className="text-sm text-muted-foreground">
                  {form.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
            </div>
          </div>

          <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
            <legend className="text-xs font-medium text-muted-foreground px-1">Criteria</legend>

            <div className="space-y-1.5">
              <Label htmlFor="rule-lead-type">Lead type</Label>
              <Select
                value={form.leadType}
                onValueChange={(v) => update('leadType', v as LeadTypeOption)}
              >
                <SelectTrigger id="rule-lead-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="buyer">Buyer</SelectItem>
                  <SelectItem value="rental">Rental</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rule-min-budget">Min budget</Label>
                <Input
                  id="rule-min-budget"
                  type="number"
                  min={0}
                  placeholder="—"
                  value={form.minBudget}
                  onChange={(e) => update('minBudget', e.target.value)}
                />
                {errors.minBudget && (
                  <p className="text-xs text-destructive">{errors.minBudget}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-max-budget">Max budget</Label>
                <Input
                  id="rule-max-budget"
                  type="number"
                  min={0}
                  placeholder="—"
                  value={form.maxBudget}
                  onChange={(e) => update('maxBudget', e.target.value)}
                />
                {errors.maxBudget && (
                  <p className="text-xs text-destructive">{errors.maxBudget}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-match-tag">Must include tag</Label>
              <Input
                id="rule-match-tag"
                value={form.matchTag}
                maxLength={60}
                placeholder="e.g. luxury"
                onChange={(e) => update('matchTag', e.target.value)}
              />
              {errors.matchTag ? (
                <p className="text-xs text-destructive">{errors.matchTag}</p>
              ) : (
                <p className={CAPTION}>Case-insensitive. Leave blank to match any tag.</p>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
            <legend className="text-xs font-medium text-muted-foreground px-1">Destination</legend>

            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="destinationKind"
                  value="agent"
                  checked={form.destinationKind === 'agent'}
                  onChange={() => update('destinationKind', 'agent')}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">Send to a specific agent</p>
                  <p className={CAPTION}>If the agent is offboarded, the engine skips this rule.</p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="destinationKind"
                  value="pool"
                  checked={form.destinationKind === 'pool'}
                  onChange={() => update('destinationKind', 'pool')}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Mini round-robin / score pick
                  </p>
                  <p className={CAPTION}>
                    Uses the realtor pool. Tag narrowing is ignored until the membership tags column ships.
                  </p>
                </div>
              </label>
            </div>

            {form.destinationKind === 'agent' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rule-agent">Agent</Label>
                <Select
                  value={form.destinationUserId}
                  onValueChange={(v) => update('destinationUserId', v)}
                >
                  <SelectTrigger id="rule-agent">
                    <SelectValue placeholder="Pick an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.length === 0 ? (
                      <div className={cn(CAPTION, 'px-3 py-2')}>No brokerage members yet.</div>
                    ) : (
                      members.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name ?? m.email}
                          {m.role !== 'realtor_member' ? ` · ${roleLabel(m.role)}` : ''}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.destinationUserId && (
                  <p className="text-xs text-destructive">{errors.destinationUserId}</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-pool-method">Pick method</Label>
                  <Select
                    value={form.destinationPoolMethod}
                    onValueChange={(v) => update('destinationPoolMethod', v as PoolMethod)}
                  >
                    <SelectTrigger id="rule-pool-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Round-robin</SelectItem>
                      <SelectItem value="score_based">Score-based</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rule-pool-tag">Pool tag (optional)</Label>
                  <Input
                    id="rule-pool-tag"
                    value={form.destinationPoolTag}
                    maxLength={60}
                    placeholder="ignored for now"
                    onChange={(e) => update('destinationPoolTag', e.target.value)}
                  />
                  {errors.destinationPoolTag && (
                    <p className="text-xs text-destructive">{errors.destinationPoolTag}</p>
                  )}
                </div>
              </div>
            )}
          </fieldset>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={cn(GHOST_PILL, 'disabled:opacity-60')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Saving…
                </>
              ) : mode.kind === 'create' ? (
                'Create rule'
              ) : (
                'Save changes'
              )}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleLabel(role: string): string {
  if (role === 'broker_owner') return 'Owner';
  if (role === 'broker_admin') return 'Admin';
  if (role === 'realtor_member') return 'Realtor';
  return role;
}

function formatBudget(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

function summarizeRule(
  rule: DealRoutingRuleRow,
  memberById: Map<string, BrokerageMember>,
): string {
  const bits: string[] = [];
  if (rule.leadType) bits.push(capitalize(rule.leadType));
  if (rule.minBudget !== null && rule.maxBudget !== null) {
    bits.push(`${formatBudget(rule.minBudget)}–${formatBudget(rule.maxBudget)}`);
  } else if (rule.minBudget !== null) {
    bits.push(`≥ ${formatBudget(rule.minBudget)}`);
  } else if (rule.maxBudget !== null) {
    bits.push(`≤ ${formatBudget(rule.maxBudget)}`);
  }
  if (rule.matchTag) bits.push(`tagged "${rule.matchTag}"`);

  const criteria = bits.length > 0 ? bits.join(', ') : 'Any lead';

  let dest: string;
  if (rule.destinationUserId) {
    const m = memberById.get(rule.destinationUserId);
    dest = m ? m.name ?? m.email : 'Unknown agent';
  } else if (rule.destinationPoolMethod === 'round_robin') {
    dest = 'Round-robin pool';
  } else if (rule.destinationPoolMethod === 'score_based') {
    dest = 'Score-based pool';
  } else {
    dest = 'Unconfigured';
  }

  return `${criteria} → ${dest}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
