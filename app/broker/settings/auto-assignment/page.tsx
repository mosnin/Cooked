'use client';

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  CAPTION,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
  PRIMARY_PILL,
} from '@/lib/typography';

type AssignmentMethod = 'manual' | 'round_robin' | 'score_based';

type SettingsResponse = {
  id: string;
  name: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  status: 'active' | 'suspended';
  privacyPolicyHtml: string | null;
  autoAssignEnabled: boolean;
  assignmentMethod: AssignmentMethod;
  lastAssignedUserId: string | null;
  lastAssignedUserName: string | null;
  realtorMemberCount: number;
  slaEnabled?: boolean;
  slaFirstResponseMinutes?: number;
  slaEscalateMinutes?: number;
};

const METHOD_LABEL: Record<AssignmentMethod, string> = {
  manual: 'Manual only',
  round_robin: 'Round-robin',
  score_based: 'Score-based',
};

const METHOD_OPTIONS: Array<{
  value: AssignmentMethod;
  label: string;
  helper: string;
}> = [
  {
    value: 'round_robin',
    label: 'Round-robin',
    helper: 'Distribute leads evenly across active realtors in rotation.',
  },
  {
    value: 'score_based',
    label: 'Score-based',
    helper: 'Send each lead to the realtor with the highest score and availability.',
  },
  {
    value: 'manual',
    label: 'Manual only',
    helper: 'Leads stay unassigned until a broker admin picks an owner.',
  },
];

export default function BrokerSettingsAutoAssignmentPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [method, setMethod] = useState<AssignmentMethod>('round_robin');
  const [slaEnabled, setSlaEnabled] = useState(false);
  const [slaFirst, setSlaFirst] = useState(60);
  const [slaEscalate, setSlaEscalate] = useState(120);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/broker/settings', { cache: 'no-store' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as SettingsResponse;
      setSettings(data);
      setEnabled(Boolean(data.autoAssignEnabled));
      const nextMethod: AssignmentMethod =
        data.assignmentMethod === 'manual' ||
        data.assignmentMethod === 'round_robin' ||
        data.assignmentMethod === 'score_based'
          ? data.assignmentMethod
          : 'round_robin';
      setMethod(nextMethod);
      setSlaEnabled(Boolean(data.slaEnabled));
      setSlaFirst(typeof data.slaFirstResponseMinutes === 'number' ? data.slaFirstResponseMinutes : 60);
      setSlaEscalate(typeof data.slaEscalateMinutes === 'number' ? data.slaEscalateMinutes : 120);
    } catch {
      setLoadError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      if (slaEnabled && slaEscalate < slaFirst) {
        toast.error('Escalation window must be at least as long as the nudge window.');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/broker/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoAssignEnabled: enabled,
          assignmentMethod: method,
          slaEnabled,
          slaFirstResponseMinutes: slaFirst,
          slaEscalateMinutes: slaEscalate,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as SettingsResponse | null;
        if (data && typeof data.autoAssignEnabled === 'boolean') {
          setSettings(data);
        }
        setSaved(true);
        toast.success('Auto-assignment saved.');
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? 'Failed to save.');
      }
    } catch {
      toast.error('Network error.');
    } finally {
      setSaving(false);
    }
  }

  const subtitle = enabled
    ? `Currently ${METHOD_LABEL[method].toLowerCase()}.`
    : 'Auto-assignment is paused. Leads stay where they land.';

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Auto-assignment
        </h1>
        <p className={BODY_MUTED}>{subtitle}</p>
      </header>

      {loading ? (
        <LoadingSkeleton />
      ) : loadError ? (
        <LoadErrorState
          message={loadError}
          onRetry={() => {
            setLoading(true);
            void loadSettings();
          }}
        />
      ) : (
        <>
          <section className="space-y-5">
            <p className={SECTION_LABEL}>How it works</p>
            <div className="flex items-start justify-between gap-4 py-3 border-b border-border/60">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-foreground">Enable auto-assignment</Label>
                <p className={CAPTION}>
                  Send new leads to a realtor automatically. Off means they sit in the inbox.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {enabled && (
              <div className="space-y-2 pt-1">
                <p className={SECTION_LABEL}>Method</p>
                <div className="divide-y divide-border/60">
                  {METHOD_OPTIONS.map((opt) => {
                    const active = method === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={cn(
                          'flex items-start gap-3 py-3 cursor-pointer transition-colors',
                          active ? 'text-foreground' : 'hover:text-foreground',
                        )}
                      >
                        <input
                          type="radio"
                          name="method"
                          value={opt.value}
                          checked={active}
                          onChange={() => setMethod(opt.value)}
                          className="mt-1"
                        />
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-foreground">{opt.label}</p>
                          <p className={CAPTION}>{opt.helper}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-6 space-y-5 border-t border-border/60">
              <p className={SECTION_LABEL}>Speed to lead</p>
              <div className="flex items-start justify-between gap-4 py-3 border-b border-border/60">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium text-foreground">Enforce response times</Label>
                  <p className={CAPTION}>
                    Hold realtors to a first-response time. Chippi nudges them, then escalates to you if a lead stays cold.
                  </p>
                </div>
                <Switch checked={slaEnabled} onCheckedChange={setSlaEnabled} />
              </div>

              {slaEnabled && (
                <div className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="sla-first" className="text-sm font-medium text-foreground">
                      Nudge the realtor after
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="sla-first"
                        type="number"
                        min={5}
                        max={1440}
                        value={slaFirst}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v)) setSlaFirst(Math.min(1440, Math.max(5, v)));
                        }}
                        className="w-24 tabular-nums"
                      />
                      <span className={CAPTION}>minutes</span>
                    </div>
                    <p className={CAPTION}>Between 5 and 1440 minutes (24 hours).</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="sla-escalate" className="text-sm font-medium text-foreground">
                      Escalate to me after
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="sla-escalate"
                        type="number"
                        min={5}
                        max={1440}
                        value={slaEscalate}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v)) setSlaEscalate(Math.min(1440, Math.max(5, v)));
                        }}
                        className="w-24 tabular-nums"
                      />
                      <span className={CAPTION}>minutes</span>
                    </div>
                    {slaEscalate < slaFirst ? (
                      <p className="text-xs text-destructive">
                        Escalation window must be at least as long as the nudge window.
                      </p>
                    ) : (
                      <p className={CAPTION}>Must be at least as long as the nudge window.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
              >
                {saving ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Saving…
                  </>
                ) : saved ? (
                  <>
                    <CheckCircle2 size={13} /> Saved
                  </>
                ) : (
                  'Save changes'
                )}
              </button>
            </div>
          </section>

          {settings?.autoAssignEnabled && (
            <RoutingActivitySection settings={settings} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routing activity — read-only snapshot, divide-y rows.
// ---------------------------------------------------------------------------

function RoutingActivitySection({ settings }: { settings: SettingsResponse }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Current method', METHOD_LABEL[settings.assignmentMethod]],
    ['Last assigned', settings.lastAssignedUserName ?? 'Nobody yet'],
    [
      'Active realtors',
      <span key="count" className="tabular-nums">
        {settings.realtorMemberCount}
      </span>,
    ],
  ];

  return (
    <section className="space-y-5 pt-10 border-t border-border/60">
      <div className="space-y-0.5">
        <p className={SECTION_LABEL}>Routing right now</p>
        <p className={CAPTION}>Live snapshot of how leads are being routed today.</p>
      </div>
      <ul className="divide-y divide-border/60">
        {rows.map(([label, value]) => (
          <li key={label} className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-foreground">{value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading + error
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <section className="space-y-5" aria-busy>
      <div className="flex items-center justify-between border-b border-border/60 py-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-6 w-11 rounded-full" />
      </div>
      <div className="space-y-2 divide-y divide-border/60">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 py-3">
            <Skeleton className="size-4 rounded-full mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-32 rounded-full" />
    </section>
  );
}

function LoadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center space-y-3">
      <p className="text-sm font-medium text-foreground">I couldn&apos;t load auto-assignment.</p>
      <p className="text-xs text-muted-foreground max-w-xs mx-auto">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(PRIMARY_PILL, 'h-8 px-3 text-xs')}
      >
        Try again
      </button>
    </div>
  );
}
