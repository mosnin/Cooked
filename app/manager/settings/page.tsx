import { getManagerContext } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { TeamSettingsForm } from '@/components/manager/settings-form';
import { TeamIntakeTrustSignalsForm } from '@/components/manager/intake-trust-signals-form';
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
 * Manager settings — general workspace identity (name, logo, website, privacy
 * policy) and the intake-form trust signals (license, compliance notice).
 *
 * The manager dashboard ships its own settings sub-nav (MCP, Auto-Assignment,
 * Routing rules, Billing) via `managerSettingsNavSections` in the sidebar, so
 * this page is the "General" leaf. Same Koala vocabulary as the rep
 * settings page: serif h1 + status sentence, hairline inputs, divide-y
 * sections, PRIMARY_PILL save.
 */
export default async function ManagerSettingsPage() {
  const ctx = await getManagerContext();
  if (!ctx) redirect('/');

  const { team, membership } = ctx;
  const canEdit = membership.role === 'manager_owner' || membership.role === 'manager_admin';

  const subtitle = canEdit
    ? `${team.name} — your team's identity and intake.`
    : `${team.name} — read-only for your role.`;

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
        <p className={SECTION_LABEL}>Team</p>
        <TeamSettingsForm
          name={team.name}
          websiteUrl={team.websiteUrl}
          logoUrl={team.logoUrl}
          joinCode={team.joinCode}
          privacyPolicyHtml={team.privacyPolicyHtml ?? null}
          isOwner={canEdit}
        />
      </section>

      <section className="space-y-5 pt-10 border-t border-border/60">
        <p className={SECTION_LABEL}>Compliance &amp; trust signals</p>
        <p className={BODY_MUTED}>
          License number, Compliance notice, and compliance mark — shown
          in the team intake-form footer for every rep on your team.
        </p>
        <TeamIntakeTrustSignalsForm
          licenseNumber={team.teamLicenseNumber ?? ''}
          complianceNotice={team.teamComplianceNotice ?? ''}
          showComplianceMark={team.teamShowComplianceMark ?? false}
          isOwner={canEdit}
        />
      </section>

      {!canEdit && (
        <p className={BODY_MUTED}>
          Only the team owner or admins can edit settings.
        </p>
      )}
    </div>
  );
}
