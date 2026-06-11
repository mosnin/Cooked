import { redirect } from 'next/navigation';
import { getManagerContext, canEditSettings } from '@/lib/permissions';
import { ConnectedAppsSection } from '@/components/settings/connected-apps-section';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Integrations — Teams' };

/**
 * /manager/integrations — team-level connected third-party accounts.
 *
 * TIERED: gated to manager_owner / manager_admin. `getManagerContext()` only
 * resolves owner/admin memberships, so a rep_member lands here as null
 * and is redirected. `canEditSettings(role)` then decides whether the connect
 * actions render at all — defense in depth on top of the API-side
 * requireManager() + canEditSettings() gate.
 *
 * Each admin/owner connects their OWN accounts at the team level via the
 * /api/manager/integrations routes (scoped to teamId + their userId).
 * These are DISTINCT from their personal rep connections — Composio uses
 * a team-namespaced entity id, so a manager can connect one inbox
 * personally and a different one for the team.
 */
export default async function ManagerIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    integration?: string;
    reason?: string;
    toolkit?: string;
  }>;
}) {
  const ctx = await getManagerContext();
  if (!ctx) redirect('/');

  const { team, membership } = ctx;
  const canEdit = canEditSettings(membership.role);
  const sp = await searchParams;

  const callbackResult =
    sp.integration === 'connected' || sp.integration === 'failed'
      ? {
          ok: sp.integration === 'connected',
          reason: sp.reason ?? null,
          toolkit: sp.toolkit ?? null,
        }
      : null;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Integrations.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Integrations
        </h1>
        <p className={BODY_MUTED}>
          Connect your tools at the {team.name} level so Koala can act
          across them.
        </p>
      </header>

      {!canEdit ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">Read-only for your role.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Only the team owner or admins can connect team
            integrations.
          </p>
        </div>
      ) : (
        <ConnectedAppsSection
          callbackResult={callbackResult}
          endpoints={{
            list: '/api/manager/integrations',
            connect: (toolkit) => `/api/manager/integrations/connect/${toolkit}`,
            item: (id) => `/api/manager/integrations/${id}`,
            // No health endpoint at the team level yet — the panel falls
            // back to the static status pill.
          }}
        />
      )}
    </div>
  );
}
