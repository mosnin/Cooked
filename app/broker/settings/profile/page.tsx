import { getBrokerContext } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { BrokerProfileForm } from '@/components/broker/profile-form';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Profile — Broker Settings' };

/**
 * /broker/settings/profile — an owner/admin's own profile within the
 * brokerage. Mirror of the realtor profile section.
 *
 * TIERED: `getBrokerContext()` only resolves owner/admin memberships, so a
 * realtor_member lands here as null and is redirected. The PATCH route is
 * self-scoped — each broker edits only their own membership row.
 */
export default async function BrokerSettingsProfilePage() {
  const ctx = await getBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage } = ctx;

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Profile
        </h1>
        <p className={BODY_MUTED}>
          Your profile within {brokerage.name} &mdash; how you show up to your
          team.
        </p>
      </header>

      <section className="space-y-5">
        <p className={SECTION_LABEL}>You</p>
        <BrokerProfileForm />
      </section>
    </div>
  );
}
