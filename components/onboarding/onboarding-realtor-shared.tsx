'use client';

/**
 * Shared onboarding building blocks - used by the V2 storytelling flow
 * (`onboarding-realtor-v2.tsx`). The legacy `onboarding-realtor.tsx`
 * keeps its own inline copies on purpose: it's the live flow, slated
 * for deletion once V2 ships to all realtors, and refactoring code
 * you're about to delete is risk with no payoff. The temporary
 * duplication evaporates with V1.
 *
 * What lives here: the stages that DON'T change between V1 and V2
 * (who-you-serve, voice, sources), the shared primitives, the option
 * constants, and the small helpers. The stages that DO change (the
 * who-you-are split, the trust promise, the typing reveal) live in V2.
 */

import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Role = 'solo' | 'team_lead' | 'brokerage_owner';
export type Tenure = 'lt1' | '1-3' | '4-10' | '10plus';
export type Tone = 'warm' | 'direct';

export type SlugState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'invalid'; message: string };

// ── Option constants ────────────────────────────────────────────────────────

/** Tenure bucket → integer yearsExperience for the AIUserProfile column. */
export const TENURE_TO_YEARS: Record<Tenure, number> = {
  lt1: 0, '1-3': 2, '4-10': 6, '10plus': 12,
};

export const CLIENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'first_time_buyers', label: 'First-time buyers' },
  { value: 'move_up_families', label: 'Move-up families' },
  { value: 'luxury', label: 'Luxury' },
  { value: 'investors', label: 'Investors' },
  { value: 'sellers', label: 'Sellers / listings' },
  { value: 'renters', label: 'Renters' },
];

export const LEAD_SOURCE_OPTIONS: { value: string; label: string; icon?: string }[] = [
  { value: 'sphere', label: 'Sphere & referrals' },
  { value: 'zillow', label: 'Zillow' },
  { value: 'facebook', label: 'Facebook', icon: '/integrations/facebook.svg' },
  { value: 'instagram', label: 'Instagram', icon: '/integrations/instagram.svg' },
  { value: 'linkedin', label: 'LinkedIn', icon: '/integrations/linkedin.svg' },
  { value: 'idx_website', label: 'IDX website' },
  { value: 'open_houses', label: 'Open houses' },
  { value: 'follow_up_boss', label: 'Follow-up Boss', icon: '/integrations/follow-up-boss.svg' },
  { value: 'mailchimp', label: 'Mailchimp', icon: '/integrations/mailchimp.svg' },
  { value: 'google_ads', label: 'Google Ads', icon: '/integrations/googleads.svg' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function toggleCapped<T>(arr: T[], v: T, cap: number): T[] {
  if (arr.includes(v)) return arr.filter((x) => x !== v);
  if (arr.length >= cap) return arr;
  return [...arr, v];
}

// ── Primitives ───────────────────────────────────────────────────────────────

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export function PickerButton({
  selected, onClick, children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-4 py-3 text-sm transition-all',
        selected
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-foreground hover:bg-foreground/[0.04]',
      )}
    >
      {children}
    </button>
  );
}

/** Primary pill used at the foot of each stage. */
export function StageContinue({
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
        className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {children} <ArrowRight size={14} />
      </button>
    </div>
  );
}

// ── Shared stages ────────────────────────────────────────────────────────────

export function StageWhoYouServe({
  clientTypes, voiceGuidance, onToggleClientType, onChangeVoiceGuidance, onContinue,
}: {
  clientTypes: string[];
  voiceGuidance: string;
  onToggleClientType: (v: string) => void;
  onChangeVoiceGuidance: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl tracking-tight text-foreground" style={{ fontFamily: 'var(--font-title)' }}>
          Who do you work with most?
        </h2>
        <p className="text-sm text-muted-foreground">Pick up to 3. I&apos;ll tune my replies and recommendations to them.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {CLIENT_TYPE_OPTIONS.map((opt) => {
          const selected = clientTypes.includes(opt.value);
          const atCap = !selected && clientTypes.length >= 3;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={atCap}
              onClick={() => onToggleClientType(opt.value)}
              className={cn(
                'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-foreground hover:bg-foreground/[0.04]',
                atCap && 'opacity-40 cursor-not-allowed',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <Section label="Anything I should always say - or never say - to a lead? (optional)">
        <textarea
          value={voiceGuidance}
          onChange={(e) => onChangeVoiceGuidance(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder='e.g. "Never push for a tour on the first message. Always sign off as Sarah from Coastal Realty."'
          className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </Section>

      <StageContinue onClick={onContinue} disabled={clientTypes.length === 0} />
    </div>
  );
}

export function StageVoice({
  name, businessName, tone, onPick,
}: {
  name: string;
  businessName: string;
  tone: Tone | null;
  onPick: (t: Tone) => void;
}) {
  const firstName = (name.trim().split(/\s+/)[0]) || 'me';
  const business = businessName.trim() || 'our team';

  const warm = `Hi! Yes, 1422 Pine is still available - great spot, I just walked through it on Saturday. Want me to send a few photos and find a time that works for you to take a look? No pressure either way. - ${firstName} at ${business}`;
  const direct = `Hi - yes, 1422 Pine is available. Asking $625K, 3 bed / 2 bath, last open house had 11 groups through. I can hold a private tour Tue 5–7p or Wed 6–7p. Which works? - ${firstName}, ${business}`;

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl tracking-tight text-foreground" style={{ fontFamily: 'var(--font-title)' }}>
          Which one sounds more like you?
        </h2>
        <p className="text-sm text-muted-foreground">
          A new lead just asked about a listing. Pick the reply that matches your voice - I&apos;ll match it from here.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VoiceCard label="Warm" body={warm} selected={tone === 'warm'} onClick={() => onPick('warm')} />
        <VoiceCard label="Direct" body={direct} selected={tone === 'direct'} onClick={() => onPick('direct')} />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        You can change this later in Settings → Profile.
      </p>
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
        'text-left rounded-xl border p-5 transition-all',
        // Paper-flat: ring, not shadow, on the selected card (STYLESHEET §Shadows).
        selected
          ? 'border-foreground bg-foreground/[0.04] ring-2 ring-foreground/10 ring-offset-2 ring-offset-background'
          : 'border-border bg-background hover:bg-foreground/[0.04]',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">{label}</p>
      <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{body}</p>
    </button>
  );
}

export function StageSources({
  leadSources, onToggle, onContinue,
}: {
  leadSources: string[];
  onToggle: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl tracking-tight text-foreground" style={{ fontFamily: 'var(--font-title)' }}>
          Where do most of your leads come from?
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick your top one or two - that&apos;s where I&apos;ll watch first. You can wire up the rest in Settings later.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {LEAD_SOURCE_OPTIONS.map((opt) => {
          const selected = leadSources.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className={cn(
                'rounded-xl border px-3 py-3 text-sm font-medium transition-all flex flex-col items-center gap-2',
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-foreground hover:bg-foreground/[0.04]',
              )}
            >
              {opt.icon ? (
                <img src={opt.icon} alt="" aria-hidden className="w-6 h-6 object-contain" />
              ) : (
                <span className={cn('w-6 h-6 rounded-md inline-flex items-center justify-center text-xs font-semibold', selected ? 'bg-background/20' : 'bg-muted text-muted-foreground')}>
                  {opt.label[0]}
                </span>
              )}
              <span className="leading-tight text-center">{opt.label}</span>
            </button>
          );
        })}
      </div>

      <StageContinue onClick={onContinue}>
        {leadSources.length === 0 ? 'Skip for now' : 'Continue'}
      </StageContinue>
    </div>
  );
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/40 px-3 py-2.5 text-sm text-rose-800 dark:text-rose-200">
      <span>{message}</span>
    </div>
  );
}
