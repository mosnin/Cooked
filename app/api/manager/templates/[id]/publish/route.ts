import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getManagerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

type TemplateCategory = 'follow-up' | 'intro' | 'closing' | 'demo-invite';
type TemplateChannel = 'sms' | 'email' | 'note';

type TeamTemplateRow = {
  id: string;
  teamId: string;
  name: string;
  category: TemplateCategory;
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  version: number;
  publishedAt: string | null;
  publishedVersion: number | null;
  publishedCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MembershipRow = { userId: string };
type SpaceRow = { id: string; ownerId: string };
type MessageTemplateRow = {
  id: string;
  spaceId: string;
  sourceTemplateId: string | null;
  sourceVersion: number | null;
};

const TEMPLATE_COLUMNS =
  'id, teamId, name, category, channel, subject, body, version, publishedAt, publishedVersion, publishedCount, createdByUserId, createdAt, updatedAt';

/**
 * POST /api/manager/templates/[id]/publish
 *
 * Push the current version of a TeamTemplate out to every rep
 * member's personal MessageTemplate table. Per the BP6a contract:
 *
 *   - If an agent already has a MessageTemplate pointing at this source
 *     (sourceTemplateId = id) AND hasn't locally edited it since the last
 *     push (sourceVersion IS NOT NULL): UPDATE their row to match the new
 *     version and bump sourceVersion.
 *   - If the agent has locally edited it (sourceVersion IS NULL): SKIP —
 *     we never silently stomp on agent customisations.
 *   - If no copy exists yet: INSERT a new MessageTemplate row.
 *
 * After the per-agent loop, stamp publishedAt = now() and publishedCount =
 * (inserted + updated) on the source template.
 *
 * Supabase-js doesn't expose multi-statement transactions, so this runs as
 * a best-effort sequence of writes. Failures on individual agent rows are
 * logged and counted but don't abort the whole publish — partial success
 * is still useful, and the manager can re-publish to retry.
 *
 * Restricted to manager_owner / manager_admin.
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { userId: clerkId } = await auth();

  const ctx = await getManagerMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.membership.role !== 'manager_owner' && ctx.membership.role !== 'manager_admin') {
    return NextResponse.json(
      { error: 'Only the owner or admins can publish templates' },
      { status: 403 },
    );
  }

  const { id: templateId } = await params;

  // 1. Load the source template scoped to the caller's team.
  const { data: tmpl, error: loadErr } = await supabase
    .from('TeamTemplate')
    .select(TEMPLATE_COLUMNS)
    .eq('id', templateId)
    .eq('teamId', ctx.team.id)
    .maybeSingle<TeamTemplateRow>();

  if (loadErr) {
    logger.error(
      '[manager/templates/publish] load failed',
      { templateId, teamId: ctx.team.id },
      loadErr,
    );
    return NextResponse.json({ error: 'Failed to load template' }, { status: 500 });
  }
  if (!tmpl) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  // 2. Enumerate rep_member userIds for this team. Managers don't
  //    get a personal copy — they own the source library.
  const { data: memberships, error: memberErr } = await supabase
    .from('TeamMembership')
    .select('userId')
    .eq('teamId', ctx.team.id)
    .eq('role', 'rep_member')
    .returns<MembershipRow[]>();

  if (memberErr) {
    logger.error(
      '[manager/templates/publish] member fetch failed',
      { templateId, teamId: ctx.team.id },
      memberErr,
    );
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }

  const agentUserIds = Array.from(
    new Set(((memberships ?? []) as MembershipRow[]).map((m) => m.userId)),
  );

  // Short-circuit: no agents -> nothing to push, but we still stamp
  // publishedAt so the UI reflects "I tried". publishedCount stays 0.
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  if (agentUserIds.length > 0) {
    // 3. Resolve each agent's Space via Space.ownerId, SCOPED to this
    //    team. A rep can be a member of this team AND also
    //    own a Space in another team (dual-membership); without the
    //    teamId filter, publishing a template from Team A would
    //    fan out into Spaces in Team B — a cross-tenant data leak.
    //    0-space members (or members whose only Space is elsewhere) are
    //    counted as skipped and logged.
    const { data: spaces, error: spaceErr } = await supabase
      .from('Space')
      .select('id, ownerId')
      .in('ownerId', agentUserIds)
      .eq('teamId', ctx.team.id)
      .returns<SpaceRow[]>();

    if (spaceErr) {
      logger.error(
        '[manager/templates/publish] space fetch failed',
        { templateId, teamId: ctx.team.id },
        spaceErr,
      );
      return NextResponse.json({ error: 'Failed to load agent spaces' }, { status: 500 });
    }

    const spaceRows = (spaces ?? []) as SpaceRow[];
    const spacesByOwner = new Map<string, SpaceRow[]>();
    for (const s of spaceRows) {
      const list = spacesByOwner.get(s.ownerId) ?? [];
      list.push(s);
      spacesByOwner.set(s.ownerId, list);
    }

    // Agents with no Space — count one skip per such agent so the manager
    // can see something didn't land. No write to do for them.
    for (const userId of agentUserIds) {
      if (!spacesByOwner.has(userId)) {
        skipped += 1;
        logger.warn('[manager/templates/publish] agent has no space; skipped', {
          templateId,
          userId,
        });
      }
    }

    const targetSpaceIds = spaceRows.map((s) => s.id);

    // 4. Find existing MessageTemplate rows that trace back to this source.
    //    We only need the rows we're about to decide about, so scope the IN
    //    clause to the target spaces. If an agent happens to have multiple
    //    rows pointing at the same source (data-wise possible — no UNIQUE
    //    constraint on (spaceId, sourceTemplateId)), we treat each row
    //    independently: locally-edited ones skip, unedited ones update.
    const existingBySpace = new Map<string, MessageTemplateRow[]>();
    if (targetSpaceIds.length > 0) {
      const { data: existing, error: existingErr } = await supabase
        .from('MessageTemplate')
        .select('id, spaceId, sourceTemplateId, sourceVersion')
        .eq('sourceTemplateId', templateId)
        .in('spaceId', targetSpaceIds)
        .returns<MessageTemplateRow[]>();

      if (existingErr) {
        logger.error(
          '[manager/templates/publish] existing fetch failed',
          { templateId, teamId: ctx.team.id },
          existingErr,
        );
        return NextResponse.json(
          { error: 'Failed to load existing copies' },
          { status: 500 },
        );
      }

      for (const row of existing ?? []) {
        const list = existingBySpace.get(row.spaceId) ?? [];
        list.push(row);
        existingBySpace.set(row.spaceId, list);
      }
    }

    const nowIso = new Date().toISOString();

    // 5. Sequential writes per space. We wrap each one in its own try/catch
    //    so a single agent's failure doesn't nuke the whole publish. See
    //    the docstring for why partial success is the desired behaviour.
    for (const space of spaceRows) {
      try {
        const existing = existingBySpace.get(space.id) ?? [];

        if (existing.length === 0) {
          // No copy yet — insert a fresh one tied to this source+version.
          const { error: insertErr } = await supabase
            .from('MessageTemplate')
            .insert({
              spaceId: space.id,
              userId: space.ownerId,
              name: tmpl.name,
              channel: tmpl.channel,
              subject: tmpl.channel === 'email' ? tmpl.subject : null,
              body: tmpl.body,
              sourceTemplateId: tmpl.id,
              sourceVersion: tmpl.version,
            });

          if (insertErr) {
            skipped += 1;
            logger.error(
              '[manager/templates/publish] insert failed',
              { templateId, spaceId: space.id },
              insertErr,
            );
          } else {
            inserted += 1;
          }
          continue;
        }

        // One or more copies exist. Update the ones that haven't been
        // locally edited (sourceVersion IS NOT NULL), skip the rest.
        for (const row of existing) {
          if (row.sourceVersion === null) {
            skipped += 1;
            logger.info(
              '[manager/templates/publish] skipped (locally edited)',
              { templateId, messageTemplateId: row.id, spaceId: space.id },
            );
            continue;
          }

          const { error: updateErr } = await supabase
            .from('MessageTemplate')
            .update({
              name: tmpl.name,
              channel: tmpl.channel,
              subject: tmpl.channel === 'email' ? tmpl.subject : null,
              body: tmpl.body,
              sourceVersion: tmpl.version,
              updatedAt: nowIso,
            })
            .eq('id', row.id);

          if (updateErr) {
            skipped += 1;
            logger.error(
              '[manager/templates/publish] update failed',
              { templateId, messageTemplateId: row.id, spaceId: space.id },
              updateErr,
            );
          } else {
            updated += 1;
          }
        }
      } catch (err) {
        // Anything we didn't anticipate — log with full context and count
        // one skip so the total is honest. Don't rethrow: one bad space
        // shouldn't abandon the rest.
        skipped += 1;
        logger.error(
          '[manager/templates/publish] unexpected error for space',
          { templateId, spaceId: space.id },
          err,
        );
      }
    }
  }

  const pushed = inserted + updated;
  const publishedAt = new Date().toISOString();

  // 6. Stamp the source row. If this fails we still return the counts —
  //    the per-agent writes already landed.
  const { error: stampErr } = await supabase
    .from('TeamTemplate')
    .update({
      publishedAt,
      // Audit follow-up: pin the exact version that was just pushed so the
      // UI can tell "up-to-date" (version === publishedVersion) from
      // "edited since last publish" (version > publishedVersion) without
      // relying on a fragile timestamp-slack heuristic.
      publishedVersion: tmpl.version,
      publishedCount: pushed,
      updatedAt: publishedAt,
    })
    .eq('id', tmpl.id)
    .eq('teamId', ctx.team.id);

  if (stampErr) {
    logger.error(
      '[manager/templates/publish] stamp failed',
      { templateId, teamId: ctx.team.id, pushed, skipped },
      stampErr,
    );
    // Don't 500 — the core publish succeeded.
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'TeamTemplate',
    resourceId: tmpl.id,
    req,
    metadata: {
      teamId: ctx.team.id,
      event: 'publish',
      version: tmpl.version,
      inserted,
      updated,
      skipped,
      pushed,
      publishedAt,
    },
  });

  return NextResponse.json({ pushed, skipped, publishedAt });
}
