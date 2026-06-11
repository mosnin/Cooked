import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { GeneralSettingsForm, DangerZone } from './general-settings-form';
import { ProfileSection } from './profile-section';
import { NotificationsSection } from './notifications-section';
import { BriefSection } from './brief-section';
import { LegalSettingsForm } from './legal/legal-settings-form';
import { IntakeTrustSignalsForm } from './intake-trust-signals-form';
import { YourDataSection } from './your-data-section';
import { McpSection, TemplatesSection } from './integrations-section';
import { ConnectedAppsSection } from '@/components/settings/connected-apps-section';
import { MemoryList } from '@/components/chippi/memory-list';
import { RoutinesManager } from '@/components/routines/routines-manager';
import { AIProfileForm } from '@/components/profile/ai-profile-form';
import { ChatModelPicker } from '@/components/agent/chat-model-picker';
import { UsageSection } from '@/components/settings/usage-section';
import { cn } from '@/lib/utils';
import type { SpaceSetting } from '@/lib/types';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PRIMARY_PILL,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

/**
 * Settings — task-grouped tabs the realtor can hold in their head:
 *
 *   Workspace    space name + slug + danger zone
 *   You          profile + bio + AI personalization + chat model
 *   Connections  OAuth apps + message templates (everywhere Chippi acts through)
 *   Memory       what Chippi has learned about this workspace
 *   Routines     the realtor's standing instructions for Chippi
 *   Privacy      notifications + legal + compliance + fair-housing notice
 *   Developer    MCP + API keys + usage (per-tool cost breakdown)
 *
 * Memory and Routines moved here from the Chippi dropdown — they describe
 * how Chippi WORKS, not what Chippi did today. The daily dropdown is for
 * daily surfaces; configuration belongs in Settings.
 *
 * Tab state lives in `?tab=...` so the URL stays shareable, sub-route
 * redirects resolve cleanly, and back-button history works. Each render
 * hydrates only the active tab's sections — the old single-scroll page
 * hydrated nine sections per load and most of them were never read.
 */

const TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'you', label: 'You' },
  { id: 'connections', label: 'Connections' },
  { id: 'memory', label: 'Memory' },
  { id: 'routines', label: 'Routines' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'developer', label: 'Developer' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function isValidTab(v: string | undefined | null): v is TabId {
  return typeof v === 'string' && TABS.some((t) => t.id === v);
}

/**
 * Map legacy tab IDs onto the new structure. The Chippi dropdown reorg
 * folded Integrations into Connections, so `?tab=integrations` now lands
 * on the Connections tab. Older aliases fold onto the closest equivalent.
 * Anything unrecognized falls through to the default tab.
 */
function resolveLegacyTab(
  raw: string | undefined,
  slug: string,
): { kind: 'redirect'; to: string } | { kind: 'tab'; id: TabId } | null {
  if (!raw) return null;
  if (isValidTab(raw)) return { kind: 'tab', id: raw };
  switch (raw) {
    case 'profile':
      return { kind: 'redirect', to: `/s/${slug}/settings?tab=you` };
    case 'apps':
    case 'integrations':
      return { kind: 'redirect', to: `/s/${slug}/settings?tab=connections` };
    case 'notifications':
      return { kind: 'redirect', to: `/s/${slug}/settings?tab=privacy` };
    case 'usage':
      return { kind: 'redirect', to: `/s/${slug}/settings?tab=developer` };
    default:
      return null;
  }
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    tab?: string;
    integration?: string;
    reason?: string;
    toolkit?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Resolve legacy tab IDs first — anyone hitting an old bookmark gets routed
  // to the new home before any DB work runs.
  const legacy = resolveLegacyTab(sp.tab, slug);
  if (legacy?.kind === 'redirect') redirect(legacy.to);
  const activeTab: TabId = legacy?.kind === 'tab' ? legacy.id : 'workspace';

  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  let settings: SpaceSetting | null = null;
  try {
    const { data, error } = await supabase
      .from('SpaceSetting')
      .select('*')
      .eq('spaceId', space.id)
      .maybeSingle();
    if (error) throw error;
    settings = (data as SpaceSetting) ?? null;
  } catch (err) {
    console.error('[settings] DB query failed', err);
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-center space-y-3 p-8">
          <h2 className="text-xl tracking-tight font-semibold text-foreground" style={TITLE_FONT}>
            I couldn&apos;t reach your settings.
          </h2>
          <p className={BODY_MUTED}>
            Usually temporary.
          </p>
          <a href={`/s/${slug}/settings`} className={PRIMARY_PILL}>
            Try again
          </a>
        </div>
      </div>
    );
  }

  // Subscription status drives the narration line under the H1.
  const subStatus =
    (space as { stripeSubscriptionStatus?: string }).stripeSubscriptionStatus ?? 'inactive';
  const periodEnd = (space as { stripePeriodEnd?: string }).stripePeriodEnd;
  const isTrialing = subStatus === 'trialing';
  const isActive = subStatus === 'active';

  let narration: string;
  if (isTrialing && periodEnd) {
    const days = Math.max(
      0,
      Math.ceil((new Date(periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    narration = `Trial ends in ${days} ${days === 1 ? 'day' : 'days'}.`;
  } else if (isActive && periodEnd) {
    const days = Math.max(
      0,
      Math.ceil((new Date(periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    narration = `Subscription active. Next charge in ${days} ${days === 1 ? 'day' : 'days'}.`;
  } else if (subStatus === 'inactive') {
    narration = 'No active subscription yet.';
  } else {
    narration = 'Workspace settings.';
  }

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-12`}>
      {/* Page header */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Settings
        </h1>
        <p className={BODY_MUTED}>
          {narration}
          {(isTrialing || isActive || subStatus === 'inactive') && (
            <>
              {' '}
              <a
                href={`/s/${slug}/billing`}
                className="underline underline-offset-2 text-foreground hover:text-foreground/80"
              >
                {subStatus === 'inactive' ? 'Start trial' : 'Manage billing'}
              </a>
            </>
          )}
        </p>
      </header>

      {/* Tab nav — horizontal scroll on mobile, fits comfortably on desktop.
          Active tab uses the foreground underline rule from STYLESHEET;
          the rest stay muted. Paper-flat, no pill chrome. */}
      <nav
        className="relative border-b border-border/60"
        aria-label="Settings sections"
      >
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex items-center gap-1 overflow-x-auto -mb-px scrollbar-hide snap-x snap-proximity"
        >
          {TABS.map((t) => {
            const isActiveTab = t.id === activeTab;
            return (
              <Link
                key={t.id}
                href={`/s/${slug}/settings?tab=${t.id}`}
                role="tab"
                aria-current={isActiveTab ? 'page' : undefined}
                aria-selected={isActiveTab}
                className={cn(
                  'inline-flex items-center px-3 py-2.5 text-sm whitespace-nowrap snap-start',
                  'border-b-2 -mb-px transition-colors duration-150',
                  isActiveTab
                    ? 'border-foreground text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        {/* Edge fade masks — signal "there's more off-screen" on mobile. */}
        <div
          aria-hidden
          className="md:hidden pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent"
        />
        <div
          aria-hidden
          className="md:hidden pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
        />
      </nav>

      {/* Workspace — space name, slug, and danger zone. Nothing else; this
          tab is identity, not configuration. */}
      {activeTab === 'workspace' && (
        <div className="space-y-12">
          <section className="space-y-5">
            <p className={SECTION_LABEL}>Workspace</p>
            <GeneralSettingsForm space={space} />
          </section>
          <section className="space-y-5 pt-10 border-t border-border/60">
            <p className={cn(SECTION_LABEL, 'text-destructive/80')}>Danger zone</p>
            <DangerZone space={space} />
          </section>
        </div>
      )}

      {/* You — profile photo, bio, AI personalization, chat model. Everything
          that shapes how Chippi sees the realtor and how the realtor shows
          up to leads. Memory has its own tab now. */}
      {activeTab === 'you' && (
        <div className="space-y-12">
          <section className="space-y-5">
            <p className={SECTION_LABEL}>Your profile</p>
            <p className={BODY_MUTED}>
              The face and voice your leads see on intake forms, tour pages,
              and packets.
            </p>
            <ProfileSection slug={space.slug} />
          </section>
          <section
            id="ai-profile"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>AI personalization</p>
            <p className={BODY_MUTED}>
              Tell Chippi about you so responses feel tailored, not generic.
            </p>
            <AIProfileForm slug={slug} spaceId={space.id} />
          </section>
          <section
            id="chat-model"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>Chippi&apos;s model</p>
            <p className={BODY_MUTED}>
              The model Chippi thinks with — in chat and when it works on its
              own. The default suits almost everyone; switch it only if you
              have a reason to.
            </p>
            <ChatModelPicker />
          </section>
        </div>
      )}

      {/* Connections — every place Chippi acts on the realtor's behalf.
          OAuth integrations and reusable templates live together because
          the realtor thinks of them as the same thing: "what Chippi sends
          through." MCP and API keys are developer-flavored and live in
          Developer instead. */}
      {activeTab === 'connections' && (
        <div className="space-y-12">
          <section id="integrations" className="space-y-5">
            <p className={SECTION_LABEL}>Connected apps</p>
            <p className={BODY_MUTED}>
              Gmail, Outlook, Slack, HubSpot, and the rest. Connect them so
              Chippi can act on your behalf through your own accounts.
            </p>
            <p className={BODY_MUTED}>Chippi never sends without your tap.</p>
            <ConnectedAppsSection
              callbackResult={
                sp.integration === 'connected' || sp.integration === 'failed'
                  ? {
                      ok: sp.integration === 'connected',
                      reason: sp.reason ?? null,
                      toolkit: sp.toolkit ?? null,
                    }
                  : null
              }
            />
          </section>
          <section
            id="templates"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>Message templates</p>
            <TemplatesSection />
          </section>
        </div>
      )}

      {/* Memory — what Chippi has learned about this workspace. Read-only
          here; the correction pattern is "delete the wrong fact and let
          Chippi re-learn it" — same logic as on the old /chippi/memory
          surface. The tab is a mount point; the list component owns the
          empty/loading/error states. */}
      {activeTab === 'memory' && (
        <div className="space-y-12">
          <section className="space-y-5">
            <p className={SECTION_LABEL}>Memory</p>
            <p className={BODY_MUTED}>
              What I&apos;m holding onto about you, your people, and your
              deals.
            </p>
            <MemoryList />
          </section>
        </div>
      )}

      {/* Routines — the realtor's standing instructions for Chippi. Read
          and write through /api/routines; the hourly cron at
          /api/cron/routines fires them. Nothing goes out without the
          realtor's tap. */}
      {activeTab === 'routines' && (
        <div className="space-y-12">
          <section className="space-y-5">
            <p className={SECTION_LABEL}>Routines</p>
            <p className={BODY_MUTED}>
              What I run on a schedule. Nothing goes out without your tap.
            </p>
            <RoutinesManager />
          </section>
        </div>
      )}

      {/* Privacy — notifications, legal URL, license, fair-housing notice.
          Everything compliance-flavored and everything that determines what
          reaches the realtor. */}
      {activeTab === 'privacy' && (
        <div className="space-y-12">
          <section id="brief" className="space-y-5">
            <p className={SECTION_LABEL}>Daily brief</p>
            <BriefSection slug={space.slug} />
          </section>
          <section
            id="notifications"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>Notifications</p>
            <NotificationsSection slug={space.slug} />
          </section>
          <section
            id="legal"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>Legal</p>
            <LegalSettingsForm
              slug={space.slug}
              privacyPolicyUrl={settings?.privacyPolicyUrl ?? ''}
            />
          </section>
          <section
            id="trust-signals"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>Compliance &amp; trust signals</p>
            <p className={BODY_MUTED}>
              Optional. License number, Fair Housing notice, and Equal Housing
              mark — shown in your intake-form footer.
            </p>
            <IntakeTrustSignalsForm
              slug={space.slug}
              licenseNumber={settings?.intakeLicenseNumber ?? ''}
              fairHousingNotice={settings?.intakeFairHousingNotice ?? ''}
              showEqualHousingMark={settings?.intakeShowEqualHousingMark ?? false}
            />
          </section>
          <section
            id="your-data"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>Your data</p>
            <p className={BODY_MUTED}>
              Take a copy of everything, or delete your account. Your data is
              yours.
            </p>
            <YourDataSection spaceName={space.name} />
          </section>
        </div>
      )}

      {/* Developer — MCP, API keys, and usage. Anything programmatic or
          cost-attribution flavored lives here so the realtor side stays
          calm. */}
      {activeTab === 'developer' && (
        <div className="space-y-12">
          <section id="mcp" className="space-y-5">
            <p className={SECTION_LABEL}>MCP &amp; API keys</p>
            <McpSection slug={space.slug} />
          </section>
          <section
            id="usage"
            className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
          >
            <p className={SECTION_LABEL}>Usage</p>
            <UsageSection />
          </section>
        </div>
      )}
    </div>
  );
}
