'use client';

/**
 * PracticeView — the practice home.
 *
 * Two calm sections: the ICPs a rep can practice against (three seeded
 * defaults plus the space's own), and the rep's recent practice calls with
 * their grades. Picking a profile starts a live mock call (the surface takes
 * over the page); finishing lands back here with the new grade in the list.
 *
 * ICP management is deliberately inline — one expanding form card, no modal
 * maze. Default profiles are read-only; the space's own can be edited or
 * removed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Phone, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/toast-helpers';
import {
  BODY,
  BODY_MUTED,
  CAPTION,
  H2,
  SECTION_LABEL,
  TITLE_FONT,
} from '@/lib/typography';
import { MockCallSurface } from './mock-call-surface';
import {
  EMPTY_PERSONA,
  type Icp,
  type IcpPersona,
  type MockCall,
} from './types';

interface Props {
  slug: string;
}

/** Editable, flat form state for an ICP (list fields as one-per-line text). */
interface IcpFormState {
  id: string | null;
  name: string;
  description: string;
  industry: string;
  company_size: string;
  role: string;
  budget_band: string;
  buying_process: string;
  temperament: string;
  pain_points: string;
  objections: string;
}

const EMPTY_FORM: IcpFormState = {
  id: null,
  name: '',
  description: '',
  ...{
    industry: EMPTY_PERSONA.industry,
    company_size: EMPTY_PERSONA.company_size,
    role: EMPTY_PERSONA.role,
    budget_band: EMPTY_PERSONA.budget_band,
    buying_process: EMPTY_PERSONA.buying_process,
    temperament: EMPTY_PERSONA.temperament,
  },
  pain_points: '',
  objections: '',
};

function toForm(icp: Icp): IcpFormState {
  return {
    id: icp.id,
    name: icp.name,
    description: icp.description ?? '',
    industry: icp.persona.industry,
    company_size: icp.persona.company_size,
    role: icp.persona.role,
    budget_band: icp.persona.budget_band,
    buying_process: icp.persona.buying_process,
    temperament: icp.persona.temperament,
    pain_points: icp.persona.pain_points.join('\n'),
    objections: icp.persona.objections.join('\n'),
  };
}

function toPersona(form: IcpFormState): IcpPersona {
  const lines = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  return {
    industry: form.industry.trim(),
    company_size: form.company_size.trim(),
    role: form.role.trim(),
    budget_band: form.budget_band.trim(),
    buying_process: form.buying_process.trim(),
    temperament: form.temperament.trim(),
    pain_points: lines(form.pain_points),
    objections: lines(form.objections),
  };
}

function scoreTone(score: number): string {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function PracticeView({ slug }: Props) {
  const [icps, setIcps] = useState<Icp[] | null>(null);
  const [sessions, setSessions] = useState<MockCall[] | null>(null);
  const [live, setLive] = useState<{ call: MockCall; icp: Icp | null } | null>(null);

  // Start-call affordance: which ICP is armed, plus the optional scenario line.
  const [armedIcpId, setArmedIcpId] = useState<string | null>(null);
  const [scenario, setScenario] = useState('');
  const [starting, setStarting] = useState(false);

  // Inline ICP form (null = closed; id null = creating).
  const [form, setForm] = useState<IcpFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const icpById = useMemo(() => {
    const map = new Map<string, Icp>();
    for (const icp of icps ?? []) map.set(icp.id, icp);
    return map;
  }, [icps]);

  const loadIcps = useCallback(async () => {
    try {
      const res = await fetch(`/api/mock-calls/icps?slug=${encodeURIComponent(slug)}`);
      const data = (await res.json().catch(() => ({}))) as { icps?: Icp[]; error?: string };
      if (!res.ok || !data.icps) throw new Error(data.error);
      setIcps(data.icps);
    } catch {
      setIcps([]);
      toastError('Could not load your customer profiles.');
    }
  }, [slug]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/mock-calls?slug=${encodeURIComponent(slug)}`);
      const data = (await res.json().catch(() => ({}))) as {
        sessions?: MockCall[];
        error?: string;
      };
      if (!res.ok || !data.sessions) throw new Error(data.error);
      setSessions(data.sessions);
    } catch {
      setSessions([]);
      toastError('Could not load your practice calls.');
    }
  }, [slug]);

  useEffect(() => {
    void loadIcps();
    void loadSessions();
  }, [loadIcps, loadSessions]);

  const startCall = async (icp: Icp) => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch('/api/mock-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, icpId: icp.id, scenario: scenario.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session?: MockCall;
        error?: string;
      };
      if (!res.ok || !data.session) {
        toastError(data.error ?? 'Could not start the practice call.');
        return;
      }
      setArmedIcpId(null);
      setScenario('');
      setLive({ call: data.session, icp });
    } catch {
      toastError('Could not start the practice call.');
    } finally {
      setStarting(false);
    }
  };

  const openSession = async (session: MockCall) => {
    try {
      const res = await fetch(
        `/api/mock-calls/${session.id}?slug=${encodeURIComponent(slug)}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        session?: MockCall;
        error?: string;
      };
      if (!res.ok || !data.session) {
        toastError(data.error ?? 'Could not open the practice call.');
        return;
      }
      setLive({
        call: data.session,
        icp: data.session.icpId ? (icpById.get(data.session.icpId) ?? null) : null,
      });
    } catch {
      toastError('Could not open the practice call.');
    }
  };

  const saveIcp = async () => {
    if (!form || saving) return;
    if (!form.name.trim()) {
      toastError('Give the profile a name.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/mock-calls/icps', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          ...(form.id ? { id: form.id } : {}),
          name: form.name.trim(),
          description: form.description.trim() || null,
          persona: toPersona(form),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { icp?: Icp; error?: string };
      if (!res.ok || !data.icp) {
        toastError(data.error ?? 'Could not save the profile.');
        return;
      }
      setForm(null);
      await loadIcps();
    } catch {
      toastError('Could not save the profile.');
    } finally {
      setSaving(false);
    }
  };

  const removeIcp = async (icp: Icp) => {
    try {
      const res = await fetch('/api/mock-calls/icps', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, id: icp.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toastError(data.error ?? 'Could not remove the profile.');
        return;
      }
      await loadIcps();
    } catch {
      toastError('Could not remove the profile.');
    }
  };

  // ── Live call takes the page ────────────────────────────────────────────
  if (live) {
    return (
      <MockCallSurface
        slug={slug}
        call={live.call}
        icp={live.icp}
        onExit={() => {
          setLive(null);
          void loadSessions();
        }}
      />
    );
  }

  const loading = icps === null || sessions === null;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-16 space-y-10">
      {/* Header */}
      <header className="space-y-1">
        <p className={cn(SECTION_LABEL)}>Practice</p>
        <h1 className={cn(H2)} style={TITLE_FONT}>
          Run a mock call with Axil
        </h1>
        <p className={cn(BODY_MUTED, 'max-w-xl')}>
          Axil plays the prospect — a real one, with the objections and temperament of the
          profile you pick. Sell, get graded, get better.
        </p>
      </header>

      {/* ICPs */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <p className={cn(SECTION_LABEL)}>Customer profiles</p>
          {!form && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...EMPTY_FORM })}
            >
              <Plus size={14} strokeWidth={2} className="mr-1.5" />
              New profile
            </Button>
          )}
        </div>

        {/* Inline create/edit form */}
        {form && (
          <div className="rounded-xl border border-border/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className={cn(BODY, 'font-medium')}>
                {form.id ? 'Edit profile' : 'New profile'}
              </p>
              <button
                type="button"
                onClick={() => setForm(null)}
                className={cn(BODY_MUTED, 'hover:text-foreground')}
                aria-label="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Profile name — e.g. Mid-market RevOps lead"
            />
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="One line on who this is (optional)"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                placeholder="Industry — e.g. B2B SaaS"
              />
              <Input
                value={form.company_size}
                onChange={(e) => setForm({ ...form, company_size: e.target.value })}
                placeholder="Company size — e.g. 200-500"
              />
              <Input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="Role — e.g. VP of Sales"
              />
              <Input
                value={form.budget_band}
                onChange={(e) => setForm({ ...form, budget_band: e.target.value })}
                placeholder="Budget — e.g. $20-50k/yr"
              />
              <Input
                value={form.buying_process}
                onChange={(e) => setForm({ ...form, buying_process: e.target.value })}
                placeholder="Buying process — e.g. committee, 2 quarters"
              />
              <Input
                value={form.temperament}
                onChange={(e) => setForm({ ...form, temperament: e.target.value })}
                placeholder="Temperament — e.g. skeptical, time-poor"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Textarea
                value={form.pain_points}
                onChange={(e) => setForm({ ...form, pain_points: e.target.value })}
                placeholder={'Pain points, one per line'}
                rows={3}
              />
              <Textarea
                value={form.objections}
                onChange={(e) => setForm({ ...form, objections: e.target.value })}
                placeholder={'Objections they raise, one per line'}
                rows={3}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={saveIcp} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save profile' : 'Create profile'}
              </Button>
            </div>
          </div>
        )}

        {/* Profile cards */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-36 rounded-xl border border-border/60 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(icps ?? []).map((icp) => {
              const armed = armedIcpId === icp.id;
              return (
                <div
                  key={icp.id}
                  className={cn(
                    'rounded-xl border p-4 space-y-2.5 transition-colors',
                    armed ? 'border-foreground/40' : 'border-border/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <p className={cn(BODY, 'font-medium truncate')}>{icp.name}</p>
                      <p className={cn(CAPTION, 'line-clamp-2')}>
                        {icp.description ??
                          [icp.persona.role, icp.persona.industry].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {icp.isDefault ? (
                      <span className={cn(CAPTION, 'shrink-0 rounded-full border border-border/60 px-2 py-0.5')}>
                        Starter
                      </span>
                    ) : (
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label="Edit profile"
                          onClick={() => setForm(toForm(icp))}
                          className={cn(BODY_MUTED, 'p-1 hover:text-foreground')}
                        >
                          <Pencil size={13} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove profile"
                          onClick={() => void removeIcp(icp)}
                          className={cn(BODY_MUTED, 'p-1 hover:text-foreground')}
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </span>
                    )}
                  </div>

                  {armed ? (
                    <div className="space-y-2">
                      <Input
                        value={scenario}
                        onChange={(e) => setScenario(e.target.value)}
                        placeholder="Scenario (optional) — e.g. cold call, they use a competitor"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void startCall(icp)} disabled={starting}>
                          <Phone size={13} strokeWidth={2} className="mr-1.5" />
                          {starting ? 'Dialing…' : 'Start call'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setArmedIcpId(null)}
                          disabled={starting}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setArmedIcpId(icp.id);
                        setScenario('');
                      }}
                    >
                      <Phone size={13} strokeWidth={2} className="mr-1.5" />
                      Practice against this
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent calls */}
      <section className="space-y-3">
        <p className={cn(SECTION_LABEL)}>Recent practice calls</p>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 rounded-lg border border-border/60 animate-pulse" />
            ))}
          </div>
        ) : (sessions ?? []).length === 0 ? (
          <p className={cn(BODY_MUTED)}>
            No practice calls yet. Pick a profile above and run your first one — it stays
            between you and Axil.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
            {(sessions ?? []).map((session) => {
              const icp = session.icpId ? icpById.get(session.icpId) : null;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => void openSession(session)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-foreground/[0.03]"
                  >
                    <span className="min-w-0 space-y-0.5">
                      <span className={cn(BODY, 'font-medium block truncate')}>
                        {icp?.name ?? 'Mock call'}
                      </span>
                      <span className={cn(CAPTION, 'block truncate')}>
                        {session.scenario ?? formatWhen(session.startedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 flex items-center gap-3">
                      {session.status === 'live' ? (
                        <span className={cn(CAPTION, 'text-emerald-600 dark:text-emerald-400')}>
                          Live
                        </span>
                      ) : session.score !== null ? (
                        <span className={cn(BODY, 'font-semibold tabular-nums', scoreTone(session.score))}>
                          {Math.round(session.score)}
                        </span>
                      ) : (
                        <span className={cn(CAPTION)}>Ungraded</span>
                      )}
                      <span className={cn(CAPTION)}>{formatWhen(session.startedAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
