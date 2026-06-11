import { redirect } from 'next/navigation';
import { getBrokerContext, canEditSettings } from '@/lib/permissions';
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
 * /broker/integrations — brokerage-level connected third-party accounts.
 *
 * TIERED: gated to broker_owner / broker_admin. `getBrokerContext()` only
 * resolves owner/admin memberships, so a realtor_member lands here as null
 * and is redirected. `canEditSettings(role)` then decides whether the connect
 * actions render at all — defense in depth on top of the API-side
 * requireBroker() + canEditSettings() gate.
 *
 * Each admin/owner connects their OWN accounts at the brokerage level via the
 * /api/broker/integrations routes (scoped to brokerageId + their userId).
 * These are DISTINCT from their personal realtor connections — Composio uses
 * a brokerage-namespaced entity id, so a broker can connect one inbox
 * personally and a different one for the brokerage.
 */
export default async function BrokerIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    integration?: string;
    reason?: string;
    toolkit?: string;
  }>;
}) {
  const ctx = await getBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage, membership } = ctx;
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
          Connect your tools at the {brokerage.name} level so Chippi can act
          across them.
        </p>
      </header>

      {!canEdit ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">Read-only for your role.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Only the brokerage owner or admins can connect brokerage
            integrations.
          </p>
        </div>
      ) : (
        <ConnectedAppsSection
          callbackResult={callbackResult}
          endpoints={{
            list: '/api/broker/integrations',
            connect: (toolkit) => `/api/broker/integrations/connect/${toolkit}`,
            item: (id) => `/api/broker/integrations/${id}`,
            // No health endpoint at the brokerage level yet — the panel falls
            // back to the static status pill.
          }}
        />
      )}
    </div>
  );
}
