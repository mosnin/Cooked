import { getBrokerContext } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { BrokerageSettingsForm } from '@/components/broker/settings-form';
import { BrokerageIntakeTrustSignalsForm } from '@/components/broker/intake-trust-signals-form';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'General settings — Teams' };

/**
 * Broker settings — general workspace identity (name, logo, website, privacy
 * policy) and the intake-form trust signals (license, fair-housing notice).
 *
 * The broker dashboard ships its own settings sub-nav (MCP, Auto-Assignment,
 * Routing rules, Billing) via `brokerSettingsNavSections` in the sidebar, so
 * this page is the "General" leaf. Same Chippi vocabulary as the realtor
 * settings page: serif h1 + status sentence, hairline inputs, divide-y
 * sections, PRIMARY_PILL save.
 */
export default async function BrokerSettingsPage() {
  const ctx = await getBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage, membership } = ctx;
  const canEdit = membership.role === 'broker_owner' || membership.role === 'broker_admin';

  const subtitle = canEdit
    ? `${brokerage.name} — your team's identity and intake.`
    : `${brokerage.name} — read-only for your role.`;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          General
        </h1>
        <p className={BODY_MUTED}>{subtitle}</p>
      </header>

      <section className="space-y-5">
        <p className={SECTION_LABEL}>Brokerage</p>
        <BrokerageSettingsForm
          name={brokerage.name}
          websiteUrl={brokerage.websiteUrl}
          logoUrl={brokerage.logoUrl}
          joinCode={brokerage.joinCode}
          privacyPolicyHtml={brokerage.privacyPolicyHtml ?? null}
          isOwner={canEdit}
        />
      </section>

      <section className="space-y-5 pt-10 border-t border-border/60">
        <p className={SECTION_LABEL}>Compliance &amp; trust signals</p>
        <p className={BODY_MUTED}>
          License number, Fair Housing notice, and Equal Housing mark — shown
          in the brokerage intake-form footer for every realtor on your team.
        </p>
        <BrokerageIntakeTrustSignalsForm
          licenseNumber={brokerage.brokerageLicenseNumber ?? ''}
          fairHousingNotice={brokerage.brokerageFairHousingNotice ?? ''}
          showEqualHousingMark={brokerage.brokerageShowEqualHousingMark ?? false}
          isOwner={canEdit}
        />
      </section>

      {!canEdit && (
        <p className={BODY_MUTED}>
          Only the brokerage owner or admins can edit settings.
        </p>
      )}
    </div>
  );
}
