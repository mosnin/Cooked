import { getBrokerContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { BrokerageMcpSection } from '../mcp-section';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'MCP — Broker Settings' };

export default async function BrokerSettingsMcpPage() {
  const ctx = await getBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage, membership } = ctx;
  const canEdit = membership.role === 'broker_owner' || membership.role === 'broker_admin';

  if (!canEdit) {
    return (
      <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
        <header className="space-y-1.5">
          <p className={BODY_MUTED}>Settings.</p>
          <h1 className={H1} style={TITLE_FONT}>
            MCP
          </h1>
          <p className={BODY_MUTED}>Read-only for your role.</p>
        </header>
        <p className={BODY_MUTED}>
          Only the brokerage owner or admins can manage MCP keys.
        </p>
      </div>
    );
  }

  // Find the broker owner's space slug for MCP key management
  const { data: ownerSpace } = await supabase
    .from('Space')
    .select('slug')
    .eq('ownerId', brokerage.ownerId)
    .maybeSingle();
  const brokerSpaceSlug = ownerSpace?.slug ?? null;

  if (!brokerSpaceSlug) {
    return (
      <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
        <header className="space-y-1.5">
          <p className={BODY_MUTED}>Settings.</p>
          <h1 className={H1} style={TITLE_FONT}>
            MCP
          </h1>
          <p className={BODY_MUTED}>
            Connect external AI tools to your brokerage data via MCP.
          </p>
        </header>
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">MCP isn&apos;t available yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            The brokerage owner needs a workspace before keys can be generated.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX} pb-56 md:pb-24`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          MCP
        </h1>
        <p className={BODY_MUTED}>
          Connect external AI tools (Claude, Cursor, Windsurf) to {brokerage.name}.
        </p>
      </header>

      <BrokerageMcpSection slug={brokerSpaceSlug} />
    </div>
  );
}
