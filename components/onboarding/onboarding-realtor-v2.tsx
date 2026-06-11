'use client';

/**
 * Realtor onboarding - V2, the conversational flow.
 *
 * The realtor doesn't fill out a form; they have a conversation with Chippi,
 * inside an interface that looks and moves exactly like the chat their own
 * leads will use. Three acts:
 *
 *   Act I  (intro)  - a cinematic cold open (OnboardingIntro): a title line,
 *                     the Chippi mark, then a blur-out into the chat.
 *   Act II (chat)   - Chippi types each question; the realtor answers through
 *                     real inline inputs rendered as their own chat bubbles.
 *                     Same surface, same motion as the live intake chat.
 *   Act III (ready) - Chippi types a real first-touch draft (the payoff), then
 *                     a closing preloader (OnboardingReady) flashes a few
 *                     working-words → "Your account is ready." → the dashboard.
 *
 * IMPORTANT - the persistence contract is UNCHANGED. Every `/api/onboarding`
 * call (check_slug, save_profile, create_space, save_realtor_profile,
 * complete) and the broker-create/space-patch sequence are byte-for-byte what
 * the prior stage-based V2 sent. This is a re-presentation of a protected
 * backend, not a change to it.
 *
 * Gated behind NEXT_PUBLIC_ONBOARDING_V2 (see app/setup/page.tsx). V1
 * (`onboarding-realtor.tsx`) stays the rollback path - don't refactor it.
 */

import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Loader2, ArrowRight, Check } from 'lucide-react';
import { cn, rootDomain } from '@/lib/utils';
import { brandOrange } from '@/lib/colors';
import { normalizeSlug, isValidSlug } from '@/lib/intake';
import { CHIPPI_PILL } from '@/lib/typography';
import { BrandLogo } from '@/components/brand-logo';
import { composeOnboardingDraft } from '@/lib/onboarding-draft';
import { OnboardingIntro, OnboardingReady } from './onboarding-cinematics';
import { ChippiSays, UserSays, AnswerAffordance, Thread } from './onboarding-chat';
import { TypingText } from './typing-text';
import {
  type Role, type Tenure, type Tone, type SlugState,
  TENURE_TO_YEARS,
  toggle, toggleCapped,
  PickerButton,
  CLIENT_TYPE_OPTIONS, LEAD_SOURCE_OPTIONS,
} from './onboarding-realtor-shared';

interface Props {
  defaultName: string;
}

type Phase = 'intro' | 'chat' | 'ready';

/** Conversation steps, in order. Bookended by the cinematics, not in here. */
type Step =
  | 'greet' | 'name' | 'role' | 'business' | 'where'
  | 'promise' | 'serve' | 'voice' | 'sources' | 'reveal';

const ORDER: Step[] = [
  'greet', 'name', 'role', 'business', 'where',
  'promise', 'serve', 'voice', 'sources', 'reveal',
];

const TENURE_OPTIONS: { value: Tenure; label: string }[] = [
  { value: 'lt1', label: 'Under a year' },
  { value: '1-3', label: '1–3 years' },
  { value: '4-10', label: '4–10 years' },
  { value: '10plus', label: '10+ years' },
];

const ROLE_LABEL: Record<Role, string> = {
  solo: "I'm a solo agent",
  team_lead: 'I lead a team',
  brokerage_owner: 'I own the brokerage',
};

export function OnboardingRealtorV2({ defaultName }: Props) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('intro');

  // Conversation position.
  const [stepIdx, setStepIdx] = useState(0);
  const [typedDone, setTypedDone] = useState(false);
  const current = ORDER[stepIdx];

  // Identity + workspace.
  const [name, setName] = useState(defaultName || '');
  const [role, setRole] = useState<Role | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ kind: 'idle' });
  const [zipCode, setZipCode] = useState('');
  const [tenure, setTenure] = useState<Tenure | null>(null);

  // Profile.
  const [clientTypes, setClientTypes] = useState<string[]>([]);
  const [voiceGuidance, setVoiceGuidance] = useState('');
  const [tone, setTone] = useState<Tone | null>(null);
  const [leadSources, setLeadSources] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceCreated, setWorkspaceCreated] = useState(false);

  // Where to land once the closing preloader finishes.
  const redirectRef = useRef<string | null>(null);

  const firstName = (name.trim().split(/\s+/)[0]) || 'there';

  // ── Navigation ──────────────────────────────────────────────────────────────

  const goToStep = useCallback((s: Step) => {
    setStepIdx(ORDER.indexOf(s));
    setTypedDone(false);
    setError(null);
  }, []);
  const advance = useCallback(() => {
    setStepIdx((i) => Math.min(i + 1, ORDER.length - 1));
    setTypedDone(false);
    setError(null);
  }, []);

  // Greet has no input - once Chippi finishes saying hello, glide to the
  // first question after a short beat.
  useEffect(() => {
    if (current !== 'greet' || !typedDone) return;
    const t = setTimeout(advance, 650);
    return () => clearTimeout(t);
  }, [current, typedDone, advance]);

  // Auto-derive slug from business name until the realtor edits it.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(normalizeSlug(businessName));
  }, [businessName, slugTouched]);

  // Debounced slug availability check (same contract as before).
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeq = useRef(0);
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (!slug) { setSlugState({ kind: 'idle' }); return; }
    if (!isValidSlug(slug)) {
      setSlugState({ kind: 'invalid', message: 'Use 3+ lowercase letters, numbers, or dashes.' });
      return;
    }
    setSlugState({ kind: 'checking' });
    const seq = ++checkSeq.current;
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_slug', slug }),
        });
        if (seq !== checkSeq.current) return;
        if (!res.ok) { setSlugState({ kind: 'invalid', message: "Couldn't check that one. Try again." }); return; }
        const data = await res.json();
        if (data.reason === 'invalid') setSlugState({ kind: 'invalid', message: 'Use 3+ lowercase letters, numbers, or dashes.' });
        else if (data.available) setSlugState({ kind: 'available' });
        else setSlugState({ kind: 'taken' });
      } catch {
        if (seq !== checkSeq.current) return;
        setSlugState({ kind: 'invalid', message: 'I lost the connection. Try again.' });
      }
    }, 350);
    return () => { if (checkTimer.current) clearTimeout(checkTimer.current); };
  }, [slug]);

  // ── Persistence (unchanged contract) ─────────────────────────────────────────

  const saveProfilePartial = useCallback(async () => {
    if (!workspaceCreated) return;
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_realtor_profile',
          role: role ?? undefined,
          zipCode: zipCode || undefined,
          yearsExperience: tenure ? TENURE_TO_YEARS[tenure] : undefined,
          businessFocus: clientTypes,
          communicationTone: tone ?? undefined,
          quirksAndPreferences: voiceGuidance || undefined,
          leadSources,
        }),
      });
    } catch (err) {
      console.error('[onboarding-v2] partial save failed', err);
    }
  }, [workspaceCreated, role, zipCode, tenure, clientTypes, tone, voiceGuidance, leadSources]);

  // End of `where` → create the workspace, then advance to the promise.
  const handleCreateWorkspace = useCallback(async () => {
    if (!role || !tenure || !/^\d{5}$/.test(zipCode.trim()) || !businessName.trim() || slugState.kind !== 'available') return;
    setSubmitting(true);
    setError(null);
    try {
      const profileRes = await fetch('/api/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_profile', name: name.trim(), businessName: businessName.trim() }),
      });
      if (!profileRes.ok) throw new Error('profile');

      const spaceRes = await fetch('/api/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_space',
          slug,
          businessName: businessName.trim(),
          intakePageTitle: 'Rental Application',
          intakePageIntro: 'Share a few details so I can review your rental fit faster.',
        }),
      });
      if (!spaceRes.ok) {
        if (spaceRes.status === 409) {
          setSlugState({ kind: 'taken' });
          setError('That URL was just taken. Pick another.');
          setSubmitting(false);
          goToStep('business');
          return;
        }
        throw new Error('space');
      }

      setWorkspaceCreated(true);
      await fetch('/api/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_realtor_profile', role, zipCode, yearsExperience: TENURE_TO_YEARS[tenure] }),
      });

      setSubmitting(false);
      advance();
    } catch {
      setError("Couldn't save that. Usually temporary.");
      setSubmitting(false);
    }
  }, [role, tenure, zipCode, businessName, slug, slugState, name, advance, goToStep]);

  // reveal "take me in" → complete, then hand off to the closing preloader,
  // which redirects when it finishes. (broker branch for owners.)
  const handleFinish = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await saveProfilePartial();

      if (role === 'brokerage_owner') {
        const completeRes = await fetch('/api/onboarding', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'complete', accountType: 'both' }),
        });
        if (!completeRes.ok) throw new Error('complete');

        const brokerRes = await fetch('/api/broker/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: businessName.trim() }),
        });
        if (!brokerRes.ok) throw new Error('broker_create');
        const brokerData = (await brokerRes.json().catch(() => ({}))) as { brokerage?: { id?: string } };
        const newBrokerageId = brokerData.brokerage?.id;
        if (newBrokerageId) {
          await fetch('/api/spaces', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, brokerageId: newBrokerageId }),
          }).catch(() => undefined);
        }
        redirectRef.current = '/broker';
        setPhase('ready');
        return;
      }

      const completeRes = await fetch('/api/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', accountType: 'realtor' }),
      });
      if (!completeRes.ok) throw new Error('complete');

      redirectRef.current = `/s/${slug}/chippi`;
      setPhase('ready');
    } catch {
      setError("Couldn't finish setup. Usually temporary.");
      setSubmitting(false);
    }
  }, [saveProfilePartial, slug, role, businessName]);

  // ── Copy ──────────────────────────────────────────────────────────────────────

  const promptFor = useCallback((s: Step): string => {
    switch (s) {
      case 'greet': return "I'm Chippi, your new companion. From here on, I'm working right alongside you.";
      case 'name': return 'First, what should I call you?';
      case 'role': return `Good to meet you, ${firstName}. What are you running?`;
      case 'business': return 'What should leads call your business?';
      case 'where': return 'Where do you work, and how long have you been at it?';
      case 'promise': return 'Before we go further, one promise: I draft, you approve. Nothing leaves without your name on it.';
      case 'serve': return "Who do you work with most? Pick up to three and I'll tune everything to them.";
      case 'voice': return 'A new lead just asked about a listing. Which reply sounds like you?';
      case 'sources': return "Where do most of your leads come from? Pick your top one or two. That's where I'll watch first.";
      case 'reveal': return `That's everything I need, ${firstName}. Now watch. Here's the first note I'd send a new lead.`;
    }
  }, [firstName]);

  // The realtor's answer bubble for a completed step. null = no bubble.
  const answerFor = useCallback((s: Step): string | null => {
    switch (s) {
      case 'name': return name.trim() || null;
      case 'role': return role ? ROLE_LABEL[role] : null;
      case 'business': return businessName.trim() ? `${businessName.trim()} · ${slug}` : null;
      case 'where': {
        const t = TENURE_OPTIONS.find((o) => o.value === tenure)?.label;
        return zipCode && t ? `${zipCode} · ${t}` : null;
      }
      case 'serve': {
        const labels = clientTypes
          .map((v) => CLIENT_TYPE_OPTIONS.find((o) => o.value === v)?.label)
          .filter(Boolean);
        return labels.length ? labels.join(', ') : null;
      }
      case 'voice': return tone ? (tone === 'warm' ? 'Warm' : 'Direct') : null;
      case 'sources': {
        const labels = leadSources
          .map((v) => LEAD_SOURCE_OPTIONS.find((o) => o.value === v)?.label)
          .filter(Boolean);
        return labels.length ? labels.join(', ') : "We'll set this up later.";
      }
      default: return null;
    }
  }, [name, role, businessName, slug, zipCode, tenure, clientTypes, tone, leadSources]);

  // ── Cinematics ──────────────────────────────────────────────────────────────

  if (phase === 'intro') {
    return <OnboardingIntro onDone={() => setPhase('chat')} />;
  }

  // ── The conversation ──────────────────────────────────────────────────────────

  return (
    <>
      <motion.div
        className="relative min-h-screen w-full overflow-hidden bg-background text-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Brand-warm wash - same as the onboarding shell, one of the five
            sanctioned orange contexts. */}
        <div
          aria-hidden
          className={brandOrange(
            'LOGO',
            'pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-orange-50/70 via-background to-orange-50/50 dark:from-orange-500/[0.04] dark:via-background dark:to-orange-500/[0.03]',
          )}
        />

        {/* Fixed brand mark - the chat's quiet header. */}
        <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex justify-center bg-gradient-to-b from-background to-transparent pt-6 pb-8">
          <BrandLogo className="h-5 opacity-80" alt="Chippi" />
        </div>

        <div className="relative z-[1]">
          <Thread signal={`${stepIdx}:${typedDone}`}>
            {/* Past turns. */}
            {ORDER.slice(0, stepIdx).map((id) => {
              const answer = answerFor(id);
              return (
                <Fragment key={id}>
                  <ChippiSays text={promptFor(id)} />
                  {answer && <UserSays>{answer}</UserSays>}
                </Fragment>
              );
            })}

            {/* Active turn - Chippi types, then the answer affordance fades in. */}
            <ChippiSays
              key={`active-${current}`}
              text={promptFor(current)}
              active
              typing
              onTyped={() => setTypedDone(true)}
            />

            {current !== 'greet' && (
              <AnswerAffordance show={typedDone}>
                {renderAffordance()}
              </AnswerAffordance>
            )}
          </Thread>
        </div>
      </motion.div>

      {phase === 'ready' && (
        <OnboardingReady
          onDone={() => {
            if (redirectRef.current) router.push(redirectRef.current);
          }}
        />
      )}
    </>
  );

  // ── Affordances ───────────────────────────────────────────────────────────────

  function renderAffordance() {
    switch (current) {
      case 'name':
        return (
          <NameAffordance value={name} onChange={setName} onContinue={() => name.trim() && advance()} />
        );

      case 'role':
        return (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <PickerButton key={r} selected={role === r} onClick={() => { setRole(r); setTimeout(advance, 360); }}>
                <span className="font-medium">{ROLE_LABEL[r]}</span>
              </PickerButton>
            ))}
          </div>
        );

      case 'business':
        return (
          <BusinessAffordance
            businessName={businessName}
            slug={slug}
            slugState={slugState}
            submitting={submitting}
            error={error}
            onChangeBusinessName={setBusinessName}
            onTouchSlug={(s) => { setSlugTouched(true); setSlug(normalizeSlug(s)); }}
            onContinue={advance}
          />
        );

      case 'where':
        return (
          <WhereAffordance
            zipCode={zipCode}
            tenure={tenure}
            submitting={submitting}
            error={error}
            onChangeZip={setZipCode}
            onChangeTenure={setTenure}
            onContinue={handleCreateWorkspace}
          />
        );

      case 'promise':
        return (
          <div className="flex justify-end">
            <button type="button" onClick={advance} className={CHIPPI_PILL}>
              Got it <ArrowRight size={14} />
            </button>
          </div>
        );

      case 'serve':
        return (
          <ServeAffordance
            clientTypes={clientTypes}
            voiceGuidance={voiceGuidance}
            onToggle={(v) => setClientTypes((prev) => toggleCapped(prev, v, 3))}
            onChangeGuidance={setVoiceGuidance}
            onContinue={() => { void saveProfilePartial(); advance(); }}
          />
        );

      case 'voice':
        return (
          <VoiceAffordance
            name={name}
            businessName={businessName}
            tone={tone}
            onPick={(t) => { setTone(t); void saveProfilePartial(); setTimeout(advance, 360); }}
          />
        );

      case 'sources':
        return (
          <SourcesAffordance
            leadSources={leadSources}
            onToggle={(v) => setLeadSources((prev) => toggle(prev, v))}
            onContinue={() => { void saveProfilePartial(); advance(); }}
          />
        );

      case 'reveal':
        return (
          <RevealAffordance
            name={name}
            businessName={businessName}
            tone={tone ?? 'warm'}
            clientTypes={clientTypes}
            leadSources={leadSources}
            submitting={submitting}
            error={error}
            onFinish={handleFinish}
          />
        );

      default:
        return null;
    }
  }
}

// ── Affordance pieces ──────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-medium text-muted-foreground">{children}</p>;
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </div>
  );
}

const INPUT_CLS =
  'w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-ring';

function SubmitPill({
  onClick, disabled, children = 'Continue',
}: {
  onClick: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {children} <ArrowRight size={14} />
      </button>
    </div>
  );
}

function NameAffordance({
  value, onChange, onContinue,
}: {
  value: string;
  onChange: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <input
        type="text"
        autoComplete="name"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onContinue(); }}
        placeholder="Sarah Chen"
        className={INPUT_CLS}
      />
      <SubmitPill onClick={onContinue} disabled={!value.trim()} />
    </div>
  );
}

function BusinessAffordance({
  businessName, slug, slugState, submitting, error,
  onChangeBusinessName, onTouchSlug, onContinue,
}: {
  businessName: string;
  slug: string;
  slugState: SlugState;
  submitting: boolean;
  error: string | null;
  onChangeBusinessName: (v: string) => void;
  onTouchSlug: (v: string) => void;
  onContinue: () => void;
}) {
  const linkPreview = slug ? `${rootDomain}/apply/${slug}` : `${rootDomain}/apply/your-business`;
  const canContinue = !submitting && businessName.trim().length > 0 && slugState.kind === 'available';
  return (
    <div className="space-y-5">
      <div>
        <FieldLabel>Business name</FieldLabel>
        <input
          type="text"
          autoFocus
          value={businessName}
          onChange={(e) => onChangeBusinessName(e.target.value)}
          placeholder="Coastal Realty"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <FieldLabel>Your intake link</FieldLabel>
        <input
          type="text"
          value={slug}
          onChange={(e) => onTouchSlug(e.target.value)}
          placeholder="your-business"
          className={cn(INPUT_CLS, 'font-mono text-sm')}
        />
        <p className="mt-1.5 break-all text-xs text-muted-foreground">{linkPreview}</p>
        <SlugHint state={slugState} />
      </div>
      {error && <ErrorLine message={error} />}
      <SubmitPill onClick={onContinue} disabled={!canContinue} />
    </div>
  );
}

function SlugHint({ state }: { state: SlugState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'checking') return <p className="mt-1 text-xs text-muted-foreground">Checking…</p>;
  if (state.kind === 'available') return <p className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check size={12} /> Available</p>;
  if (state.kind === 'taken') return <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Taken. Try another.</p>;
  return <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{state.message}</p>;
}

function WhereAffordance({
  zipCode, tenure, submitting, error, onChangeZip, onChangeTenure, onContinue,
}: {
  zipCode: string;
  tenure: Tenure | null;
  submitting: boolean;
  error: string | null;
  onChangeZip: (v: string) => void;
  onChangeTenure: (t: Tenure) => void;
  onContinue: () => void;
}) {
  const canContinue = !submitting && /^\d{5}$/.test(zipCode.trim()) && tenure !== null;
  return (
    <div className="space-y-5">
      <div>
        <FieldLabel>Primary ZIP code</FieldLabel>
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={zipCode}
          onChange={(e) => onChangeZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          placeholder="33139"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <FieldLabel>How long have you been in real estate?</FieldLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TENURE_OPTIONS.map((opt) => (
            <PickerButton key={opt.value} selected={tenure === opt.value} onClick={() => onChangeTenure(opt.value)}>
              <span className="font-medium">{opt.label}</span>
            </PickerButton>
          ))}
        </div>
      </div>
      {error && <ErrorLine message={error} />}
      <SubmitPill onClick={onContinue} disabled={!canContinue}>
        {submitting ? <Loader2 size={14} className="animate-spin" /> : 'Continue'}
      </SubmitPill>
    </div>
  );
}

function ServeAffordance({
  clientTypes, voiceGuidance, onToggle, onChangeGuidance, onContinue,
}: {
  clientTypes: string[];
  voiceGuidance: string;
  onToggle: (v: string) => void;
  onChangeGuidance: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CLIENT_TYPE_OPTIONS.map((opt) => {
          const selected = clientTypes.includes(opt.value);
          const atCap = !selected && clientTypes.length >= 3;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={atCap}
              onClick={() => onToggle(opt.value)}
              className={cn(
                'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-foreground hover:bg-foreground/[0.04]',
                atCap && 'cursor-not-allowed opacity-40',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div>
        <FieldLabel>Anything I should always say, or never say, to a lead? (optional)</FieldLabel>
        <textarea
          value={voiceGuidance}
          onChange={(e) => onChangeGuidance(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder='e.g. "Never push for a tour on the first message. Always sign off as Sarah from Coastal Realty."'
          className={cn(INPUT_CLS, 'resize-none text-sm')}
        />
      </div>
      <SubmitPill onClick={onContinue} disabled={clientTypes.length === 0} />
    </div>
  );
}

function VoiceAffordance({
  name, businessName, tone, onPick,
}: {
  name: string;
  businessName: string;
  tone: Tone | null;
  onPick: (t: Tone) => void;
}) {
  const firstName = (name.trim().split(/\s+/)[0]) || 'me';
  const business = businessName.trim() || 'our team';
  const warm = `Hi! Yes, 1422 Pine is still available, and it's a great spot. I just walked through it on Saturday. Want me to send a few photos and find a time that works for you to take a look? No pressure either way. ${firstName} at ${business}`;
  const direct = `Hi, yes, 1422 Pine is available. Asking $625K, 3 bed / 2 bath, last open house had 11 groups through. I can hold a private tour Tue 5–7p or Wed 6–7p. Which works? ${firstName}, ${business}`;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <VoiceCard label="Warm" body={warm} selected={tone === 'warm'} onClick={() => onPick('warm')} />
      <VoiceCard label="Direct" body={direct} selected={tone === 'direct'} onClick={() => onPick('direct')} />
    </div>
  );
}

function VoiceCard({
  label, body, selected, onClick,
}: {
  label: string;
  body: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border p-5 text-left transition-all',
        selected
          ? 'border-foreground bg-foreground/[0.04] ring-2 ring-foreground/10 ring-offset-2 ring-offset-background'
          : 'border-border bg-background hover:bg-foreground/[0.04]',
      )}
    >
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{body}</p>
    </button>
  );
}

function SourcesAffordance({
  leadSources, onToggle, onContinue,
}: {
  leadSources: string[];
  onToggle: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {LEAD_SOURCE_OPTIONS.map((opt) => {
          const selected = leadSources.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-all',
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-foreground hover:bg-foreground/[0.04]',
              )}
            >
              {opt.icon ? (
                <img src={opt.icon} alt="" aria-hidden className="h-6 w-6 object-contain" />
              ) : (
                <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold', selected ? 'bg-background/20' : 'bg-muted text-muted-foreground')}>
                  {opt.label[0]}
                </span>
              )}
              <span className="text-center leading-tight">{opt.label}</span>
            </button>
          );
        })}
      </div>
      <SubmitPill onClick={onContinue}>
        {leadSources.length === 0 ? 'Skip for now' : 'Continue'}
      </SubmitPill>
    </div>
  );
}

function RevealAffordance({
  name, businessName, tone, clientTypes, leadSources, submitting, error, onFinish,
}: {
  name: string;
  businessName: string;
  tone: Tone;
  clientTypes: string[];
  leadSources: string[];
  submitting: boolean;
  error: string | null;
  onFinish: () => void;
}) {
  const draft = composeOnboardingDraft({ name, businessName, tone, clientTypes, leadSources });
  const [typed, setTyped] = useState(false);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/70 bg-card p-5">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Draft · {tone === 'warm' ? 'Warm' : 'Direct'}
        </p>
        <p className="min-h-[7.5rem] text-sm leading-relaxed text-foreground">
          <TypingText text={draft.body} onDone={() => setTyped(true)} />
        </p>
      </div>
      {error && <ErrorLine message={error} />}
      <div className={cn('flex justify-end transition-opacity duration-500', typed ? 'opacity-100' : 'pointer-events-none opacity-0')}>
        <button type="button" onClick={onFinish} disabled={submitting} className={CHIPPI_PILL}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <>Looks good, take me in <ArrowRight size={14} /></>}
        </button>
      </div>
    </div>
  );
}
