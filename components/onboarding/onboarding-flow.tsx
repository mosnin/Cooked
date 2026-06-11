'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Briefcase,
  Building2,
  HandCoins,
  Home,
  Share2,
  Users2,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OnboardingShell } from './onboarding-shell';
import { OnboardingIntro, OnboardingReady } from './onboarding-cinematics';
import {
  MultiFieldStep,
  PhotoStep,
  SlugStep,
  StepScaffold,
  TextStep,
  TilesStep,
  type TileOption,
} from './onboarding-steps';

// ── Brokerage cinematics copy ───────────────────────────────────────────────
// The brokerage flow gets its OWN bookend preloaders (separate from the
// realtor cold open), built on the same OnboardingIntro / OnboardingReady
// engine. Module-level so their array identity is stable across renders.
const BROKER_INTRO_LINE = 'Introducing the future of brokerage software.';
const BROKER_READY_WORDS = ['Building.', 'Wiring.', 'Done.'] as const;

// ── Role ───────────────────────────────────────────────────────────────────

type Role = 'realtor' | 'broker' | 'broker_only';

const ROLE_OPTIONS: TileOption<Role>[] = [
  { value: 'realtor',     label: 'Realtor',           description: 'Solo agent with a pipeline.',      icon: Home },
  { value: 'broker',      label: 'Broker + realtor',  description: 'Run a team and sell.',             icon: Briefcase },
  { value: 'broker_only', label: 'Broker only',       description: 'Team lead - no personal pipeline.', icon: Building2 },
];

// ── Shared option sets ─────────────────────────────────────────────────────

const TIMEZONES: TileOption<string>[] = [
  { value: 'America/New_York',    label: 'Eastern',  description: 'New York, Miami, Atlanta' },
  { value: 'America/Chicago',     label: 'Central',  description: 'Chicago, Austin, Dallas' },
  { value: 'America/Denver',      label: 'Mountain', description: 'Denver, Phoenix' },
  { value: 'America/Los_Angeles', label: 'Pacific',  description: 'LA, San Francisco, Seattle' },
  { value: 'America/Anchorage',   label: 'Alaska' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii' },
];

const HEAR_ABOUT: TileOption<string>[] = [
  { value: 'referral',     label: 'Referral',      icon: Share2 },
  { value: 'google',       label: 'Google search' },
  { value: 'social',       label: 'Social media' },
  { value: 'word',         label: 'Word of mouth' },
  { value: 'other',        label: 'Something else' },
];

const AGENT_COUNT: TileOption<string>[] = [
  { value: '1-5',   label: '1–5' },
  { value: '5-15',  label: '5–15' },
  { value: '15-50', label: '15–50' },
  { value: '50+',   label: '50+' },
];

const BROKERAGE_TYPE: TileOption<string>[] = [
  { value: 'independent', label: 'Independent', icon: Building2 },
  { value: 'franchise',   label: 'Franchise',   icon: Briefcase },
  { value: 'virtual',     label: 'Virtual',     icon: Users2 },
];

const PRIMARY_MARKET: TileOption<string>[] = [
  { value: 'residential_rental', label: 'Residential rental' },
  { value: 'commercial',         label: 'Commercial' },
  { value: 'mixed',              label: 'Mixed' },
];

const COMMISSION_STRUCTURE: TileOption<string>[] = [
  { value: 'flat_fee',          label: 'Flat fee',          icon: Wallet },
  { value: 'percentage_split',  label: 'Percentage split',  icon: HandCoins },
  { value: 'hybrid',            label: 'Hybrid' },
];

// ── Form values ────────────────────────────────────────────────────────────

interface FormValues {
  name: string;
  role: Role | null;
  // Realtor / broker-with-workspace
  businessName: string;
  slug: string;
  realtorPhone: string;
  realtorBio: string;
  logoUrl: string | null;
  // Shared
  timezone: string;
  hearAbout: string;
  // Brokerage
  brokerageName: string;
  brokerWebsiteUrl: string;
  officeAddress: string;
  officePhone: string;
  brokerLogoUrl: string;
  agentCount: string;
  brokerageType: string;
  primaryMarket: string;
  commissionStructure: string;
  geographicCoverage: string;
}

// ── Step sequencing ────────────────────────────────────────────────────────

/**
 * Step ids for the full catalog. Each role path picks a subset in order. A
 * string union rather than enum so typos surface at compile time.
 *
 * `role-and-timezone` is one screen that captures both - collapsing two earlier
 * friction steps into a single pill-pair. Pain-point survey was removed; Chippi
 * infers usage from behavior.
 */
type StepId =
  | 'role-and-timezone'
  | 'name'
  | 'business-name'
  | 'slug'
  | 'about-you'          // grouped: phone + bio
  | 'logo'
  | 'hear'
  | 'brokerage-name'
  | 'brokerage-contact'  // grouped: office address + phone
  | 'brokerage-logo'
  | 'brokerage-agent-count'
  | 'brokerage-type'
  | 'brokerage-market'
  | 'brokerage-commission';

/**
 * Compute the step sequence from the chosen role. The combined
 * `role-and-timezone` step is always first; both fields must be set before the
 * role-dependent branches can be computed.
 *
 * User-narrative steps shrink from 5 (role, name, timezone, pain, hear) to 3
 * (role+timezone, name, hear) - the rest of the count depends on the path.
 */
function stepsFor(role: Role | null): StepId[] {
  if (!role) return ['role-and-timezone'];

  const base: StepId[] = ['role-and-timezone', 'name'];
  if (role === 'realtor' || role === 'broker') {
    base.push('business-name', 'slug', 'about-you', 'logo');
  }
  if (role === 'broker' || role === 'broker_only') {
    base.push(
      'brokerage-name',
      'brokerage-contact',
      'brokerage-logo',
      'brokerage-agent-count',
      'brokerage-type',
      'brokerage-market',
      'brokerage-commission',
    );
  }
  base.push('hear');
  return base;
}

// ── Component ──────────────────────────────────────────────────────────────

interface OnboardingFlowProps {
  defaultName: string;
  /**
   * The signed-in user's Clerk avatar. Intentionally not used to prefill the
   * business-logo step - a realtor's profile photo should not double as their
   * company logo. Accepted here so callers can pass it for a future
   * avatar-specific step.
   */
  userImageUrl?: string;
}

export function OnboardingFlow({ defaultName, userImageUrl: _userImageUrl }: OnboardingFlowProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    name: defaultName || '',
    role: null,
    businessName: '',
    slug: '',
    realtorPhone: '',
    realtorBio: '',
    logoUrl: null,
    timezone: '',
    hearAbout: '',
    brokerageName: '',
    brokerWebsiteUrl: '',
    officeAddress: '',
    officePhone: '',
    brokerLogoUrl: '',
    agentCount: '',
    brokerageType: '',
    primaryMarket: '',
    commissionStructure: '',
    geographicCoverage: '',
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Cinematic bookends. 'intro' plays the cold open, 'flow' is the form,
  // 'ready' plays the closing preloader which then redirects.
  const [phase, setPhase] = useState<'intro' | 'flow' | 'ready'>('intro');
  const redirectRef = useRef<string | null>(null);

  const set = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const steps = useMemo(() => stepsFor(values.role), [values.role]);
  const stepId = steps[stepIndex];
  const totalSteps = steps.length;

  const isLastStep = stepIndex === steps.length - 1;

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(async () => {
    if (!isLastStep) {
      setStepIndex((i) => i + 1);
      return;
    }
    await finalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLastStep]);

  const checkSlug = useCallback(async (slug: string) => {
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_slug', slug }),
      });
      if (!res.ok) return { available: false, error: 'Could not check availability' };
      const data = await res.json();
      // Server returns { available, reason }. Map 'invalid' to a readable
      // message; otherwise fall back to the SlugStep default.
      if (data.reason === 'invalid') {
        return { available: false, error: 'Use 3+ lowercase letters, numbers, or dashes.' };
      }
      return { available: !!data.available };
    } catch {
      return { available: false, error: 'Network error' };
    }
  }, []);

  async function finalize() {
    const role = values.role!;
    setSubmitting(true);
    try {
      if (role === 'broker_only') {
        // Broker-only: skip workspace creation.
        // User-level fields (timezone, hearAbout, etc.) aren't persisted in
        // this path - save_profile doesn't accept them and there's no
        // create_space call. Pre-existing API limitation.
        const profileRes = await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_profile',
            name: values.name.trim(),
            phone: '',
            businessName: values.brokerageName.trim(),
          }),
        });
        if (!profileRes.ok) throw await errorFrom(profileRes);

        const brokerRes = await fetch('/api/broker/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(brokerCreateBody(values)),
        });
        if (!brokerRes.ok) throw await errorFrom(brokerRes);

        const completeRes = await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'complete', accountType: 'broker_only' }),
        });
        if (!completeRes.ok) throw await errorFrom(completeRes);

        redirectRef.current = '/broker';
        setPhase('ready');
        return;
      }

      // Realtor or broker-with-workspace. Personal phone is collected on the
      // about-you step for both roles, so persist it in both cases.
      const profileRes = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_profile',
          name: values.name.trim(),
          phone: values.realtorPhone.trim(),
          businessName: values.businessName.trim(),
        }),
      });
      if (!profileRes.ok) throw await errorFrom(profileRes);

      // create_space persists space-level config AND User-level fields via its
      // userUpdates block - so we send timezone, bio, and referralSource here
      // (save_profile silently drops them). biggestPainPoint is intentionally
      // null: the survey step was removed; Chippi infers usage from behavior.
      const spaceRes = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_space',
          slug: values.slug.trim(),
          intakePageTitle: 'Rental Application',
          intakePageIntro: 'Share a few details so I can review your rental fit faster.',
          businessName: values.businessName.trim(),
          logoUrl: values.logoUrl ?? undefined,
          bio: values.realtorBio.trim() || undefined,
          phone: values.realtorPhone.trim() || undefined,
          timezone: values.timezone || undefined,
          referralSource: values.hearAbout || undefined,
          biggestPainPoint: null,
        }),
      });
      const spaceData = await spaceRes.json().catch(() => ({}));
      if (!spaceRes.ok) {
        if (spaceRes.status === 409) {
          toast.error('That slug was just taken. Pick a different one.');
          setSubmitting(false);
          const slugIndex = steps.indexOf('slug');
          if (slugIndex >= 0) setStepIndex(slugIndex);
          return;
        }
        throw new Error(spaceData?.error || 'Failed to create workspace.');
      }

      if (role === 'broker') {
        const brokerRes = await fetch('/api/broker/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(brokerCreateBody(values)),
        });
        const brokerData = await brokerRes.json().catch(() => ({}));
        if (!brokerRes.ok) throw new Error(brokerData?.error || 'Failed to create brokerage.');

        const newBrokerageId = brokerData.brokerage?.id;
        if (newBrokerageId && spaceData?.slug) {
          await fetch('/api/spaces', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: spaceData.slug, brokerageId: newBrokerageId }),
          }).catch(() => undefined);
        }
      }

      const accountType = role === 'broker' ? 'both' : 'realtor';
      const completeRes = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', accountType }),
      });
      if (!completeRes.ok) throw await errorFrom(completeRes);

      redirectRef.current = role === 'broker'
        ? '/broker'
        : `/s/${(spaceData.slug as string) ?? values.slug}`;
      setPhase('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : "That tripped me up. Try again.";
      toast.error(msg);
      setSubmitting(false);
    }
  }

  // Cold open — the brokerage cinematic preloader, before the form.
  if (phase === 'intro') {
    return <OnboardingIntro line={BROKER_INTRO_LINE} onDone={() => setPhase('flow')} />;
  }

  return (
    <>
    <OnboardingShell
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      stepKey={stepId}
      onBack={stepIndex > 0 && !submitting ? goBack : undefined}
    >
      {stepId === 'role-and-timezone' && (
        <RoleAndTimezoneStep
          role={values.role}
          timezone={values.timezone}
          onSelectRole={(v) => set('role', v)}
          onSelectTimezone={(v) => set('timezone', v)}
          onNext={() => setStepIndex((i) => i + 1)}
        />
      )}

      {stepId === 'name' && (
        <TextStep
          title="What's your name?"
          label="Full name"
          placeholder="Jane Doe"
          value={values.name}
          onChange={(v) => set('name', v)}
          onNext={goNext}
          required
          maxLength={120}
        />
      )}

      {stepId === 'business-name' && (
        <TextStep
          title="What do you call your business?"
          subtitle="Goes on intake forms, emails, and your public page."
          label="Business or brand name"
          placeholder="Sunset Realty"
          value={values.businessName}
          onChange={(v) => set('businessName', v)}
          onNext={goNext}
          required
          maxLength={120}
        />
      )}

      {stepId === 'slug' && (
        <SlugStep
          title="Pick your intake link"
          subtitle="This is the URL you'll share with new leads."
          value={values.slug}
          onChange={(v) => set('slug', v)}
          onNext={goNext}
          onCheck={checkSlug}
        />
      )}

      {stepId === 'about-you' && (
        <MultiFieldStep
          title="A little about you"
          subtitle="Both optional - shown on your intake page and emails."
          fields={[
            {
              key: 'phone',
              label: 'Phone number',
              placeholder: '(415) 555-0123',
              type: 'tel',
              value: values.realtorPhone,
              onChange: (v) => set('realtorPhone', v),
              maxLength: 40,
            },
            {
              key: 'bio',
              label: 'Short bio',
              placeholder: '15 years helping families find their next home.',
              value: values.realtorBio,
              onChange: (v) => set('realtorBio', v),
              maxLength: 500,
              multiline: true,
              rows: 3,
            },
          ]}
          onNext={goNext}
          onSkip={goNext}
        />
      )}

      {stepId === 'logo' && (
        <PhotoStep
          title="Add your business logo"
          subtitle="Shown on your intake form and email templates."
          value={values.logoUrl}
          onChange={(url) => set('logoUrl', url)}
          onNext={goNext}
          onSkip={goNext}
          uploadKind="logo"
        />
      )}

      {stepId === 'brokerage-name' && (
        <TextStep
          title="What's your brokerage called?"
          label="Brokerage name"
          placeholder="Sunset Realty Group"
          value={values.brokerageName}
          onChange={(v) => set('brokerageName', v)}
          onNext={goNext}
          required
          maxLength={120}
        />
      )}

      {stepId === 'brokerage-contact' && (
        <MultiFieldStep
          title="Where should leads find you?"
          subtitle="Optional - office address and a main phone line."
          fields={[
            {
              key: 'officeAddress',
              label: 'Office address',
              placeholder: '500 Main St, Oakland, CA',
              value: values.officeAddress,
              onChange: (v) => set('officeAddress', v),
              maxLength: 200,
            },
            {
              key: 'officePhone',
              label: 'Office phone',
              placeholder: '(415) 555-0199',
              type: 'tel',
              value: values.officePhone,
              onChange: (v) => set('officePhone', v),
              maxLength: 40,
            },
          ]}
          onNext={goNext}
          onSkip={goNext}
        />
      )}

      {stepId === 'brokerage-logo' && (
        <PhotoStep
          title="Add your brokerage logo"
          subtitle="Optional - goes on emails and shared packets."
          value={values.brokerLogoUrl || null}
          onChange={(url) => set('brokerLogoUrl', url ?? '')}
          onNext={goNext}
          onSkip={goNext}
          uploadKind="broker_logo"
        />
      )}

      {stepId === 'brokerage-agent-count' && (
        <TilesStep
          title="How many agents on the team?"
          options={AGENT_COUNT}
          value={values.agentCount || null}
          onSelect={(v) => set('agentCount', v)}
          onNext={goNext}
          columns={4}
          advanceOnSelect
        />
      )}

      {stepId === 'brokerage-type' && (
        <TilesStep
          title="What kind of brokerage are you?"
          options={BROKERAGE_TYPE}
          value={values.brokerageType || null}
          onSelect={(v) => set('brokerageType', v)}
          onNext={goNext}
          columns={3}
          advanceOnSelect
        />
      )}

      {stepId === 'brokerage-market' && (
        <TilesStep
          title="Primary market?"
          options={PRIMARY_MARKET}
          value={values.primaryMarket || null}
          onSelect={(v) => set('primaryMarket', v)}
          onNext={goNext}
          columns={3}
          advanceOnSelect
        />
      )}

      {stepId === 'brokerage-commission' && (
        <TilesStep
          title="How do you structure commission?"
          options={COMMISSION_STRUCTURE}
          value={values.commissionStructure || null}
          onSelect={(v) => set('commissionStructure', v)}
          onNext={goNext}
          columns={3}
          advanceOnSelect
        />
      )}

      {stepId === 'hear' && (
        <TilesStep
          title="How did you hear about Chippi?"
          options={HEAR_ABOUT}
          value={values.hearAbout || null}
          onSelect={(v) => set('hearAbout', v)}
          onNext={goNext}
          columns={3}
          advanceOnSelect={false}
          busy={submitting}
        />
      )}
    </OnboardingShell>

    {phase === 'ready' && (
      <OnboardingReady
        words={BROKER_READY_WORDS}
        finalLine={values.role === 'realtor' ? 'Your account is ready.' : 'Your brokerage is ready.'}
        onDone={() => { if (redirectRef.current) router.push(redirectRef.current); }}
      />
    )}
    </>
  );
}

// ── Combined role + timezone step ──────────────────────────────────────────

interface RoleAndTimezoneStepProps {
  role: Role | null;
  timezone: string;
  onSelectRole: (v: Role) => void;
  onSelectTimezone: (v: string) => void;
  onNext: () => void;
}

/**
 * Single screen that captures both role and timezone - collapses what used to
 * be the first and seventh-or-so steps into one. Both required to advance.
 * Two pill groups side-by-side on wide screens, stacked on mobile. Uses the
 * same `motion.button` tile primitive as `TilesStep` for visual continuity.
 */
function RoleAndTimezoneStep({
  role,
  timezone,
  onSelectRole,
  onSelectTimezone,
  onNext,
}: RoleAndTimezoneStepProps) {
  const ready = role !== null && timezone.length > 0;
  return (
    <StepScaffold
      title="Tell us about you"
      subtitle="Two quick taps so we can tailor the setup and times to match."
      onPrimary={onNext}
      primaryDisabled={!ready}
      primaryLabel="Continue"
    >
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 text-left sm:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your role
          </p>
          <div className="flex flex-col gap-2">
            {ROLE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = role === opt.value;
              return (
                <motion.button
                  key={opt.value}
                  type="button"
                  onClick={() => onSelectRole(opt.value)}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    'group flex items-start gap-3 rounded-xl border bg-background px-4 py-3 text-left transition-colors duration-150',
                    selected
                      ? 'border-foreground/40 bg-foreground/[0.045] ring-2 ring-foreground/10'
                      : 'border-border/70 hover:bg-foreground/[0.04]',
                  )}
                >
                  {Icon && (
                    <Icon
                      size={18}
                      className={cn(
                        'mt-0.5 shrink-0 transition-colors',
                        selected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
                      )}
                    />
                  )}
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{opt.label}</span>
                    {opt.description && (
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    )}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your time zone
          </p>
          <div className="flex flex-col gap-2">
            {TIMEZONES.map((opt) => {
              const selected = timezone === opt.value;
              return (
                <motion.button
                  key={opt.value}
                  type="button"
                  onClick={() => onSelectTimezone(opt.value)}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3 text-left transition-colors duration-150',
                    selected
                      ? 'border-foreground/40 bg-foreground/[0.045] ring-2 ring-foreground/10'
                      : 'border-border/70 hover:bg-foreground/[0.04]',
                  )}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{opt.label}</span>
                    {opt.description && (
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    )}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    </StepScaffold>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function brokerCreateBody(v: FormValues) {
  return {
    name: v.brokerageName.trim(),
    logoUrl: v.brokerLogoUrl.trim() || undefined,
    websiteUrl: v.brokerWebsiteUrl.trim() || undefined,
    officeAddress: v.officeAddress.trim() || undefined,
    officePhone: v.officePhone.trim() || undefined,
    agentCount: v.agentCount || undefined,
    brokerageType: v.brokerageType || undefined,
    primaryMarket: v.primaryMarket || undefined,
    commissionStructure: v.commissionStructure || undefined,
    geographicCoverage: v.geographicCoverage.trim() || undefined,
  };
}

async function errorFrom(res: Response) {
  const data = await res.json().catch(() => ({}));
  return new Error(data?.error || `Request failed (${res.status})`);
}
