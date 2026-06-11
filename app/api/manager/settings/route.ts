import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireManager, canEditSettings } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';

type AssignmentMethod = 'manual' | 'round_robin' | 'score_based';

const ASSIGNMENT_METHODS: readonly AssignmentMethod[] = [
  'manual',
  'round_robin',
  'score_based',
];

type TeamAutoAssignFields = {
  autoAssignEnabled?: boolean | null;
  assignmentMethod?: string | null;
  lastAssignedUserId?: string | null;
  slaEnabled?: boolean | null;
  slaFirstResponseMinutes?: number | null;
  slaEscalateMinutes?: number | null;
};

type SettingsResponse = {
  id: string;
  name: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  status: 'active' | 'suspended';
  privacyPolicyHtml: string | null;
  autoAssignEnabled: boolean;
  assignmentMethod: AssignmentMethod;
  lastAssignedUserId: string | null;
  lastAssignedUserName: string | null;
  repMemberCount: number;
  slaEnabled: boolean;
  slaFirstResponseMinutes: number;
  slaEscalateMinutes: number;
  teamLicenseNumber: string | null;
  teamFairHousingNotice: string | null;
  teamShowEqualHousingMark: boolean;
};

/**
 * Resolve the auto-assignment metadata for a team. Resilient to the
 * underlying columns not existing yet (pre-BP7a migration) — in that case we
 * fall back to disabled/manual with no cursor.
 */
async function resolveAutoAssignMeta(teamId: string): Promise<{
  autoAssignEnabled: boolean;
  assignmentMethod: AssignmentMethod;
  lastAssignedUserId: string | null;
  lastAssignedUserName: string | null;
  repMemberCount: number;
  slaEnabled: boolean;
  slaFirstResponseMinutes: number;
  slaEscalateMinutes: number;
}> {
  let autoAssignEnabled = false;
  let assignmentMethod: AssignmentMethod = 'manual';
  let lastAssignedUserId: string | null = null;
  let slaEnabled = false;
  let slaFirstResponseMinutes = 60;
  let slaEscalateMinutes = 120;

  // Explicitly select the new columns so we can detect a missing-column error
  // and degrade gracefully. If the SELECT errors (e.g. columns don't exist
  // yet), we keep the defaults above — the page stays usable for every manager.
  const { data: extra, error: extraErr } = await supabase
    .from('Team')
    .select(
      'autoAssignEnabled, assignmentMethod, lastAssignedUserId, ' +
      'slaEnabled, slaFirstResponseMinutes, slaEscalateMinutes'
    )
    .eq('id', teamId)
    .maybeSingle<TeamAutoAssignFields>();

  if (!extraErr && extra) {
    if (typeof extra.autoAssignEnabled === 'boolean') {
      autoAssignEnabled = extra.autoAssignEnabled;
    }
    if (
      typeof extra.assignmentMethod === 'string' &&
      (ASSIGNMENT_METHODS as readonly string[]).includes(extra.assignmentMethod)
    ) {
      assignmentMethod = extra.assignmentMethod as AssignmentMethod;
    }
    if (typeof extra.lastAssignedUserId === 'string' && extra.lastAssignedUserId) {
      lastAssignedUserId = extra.lastAssignedUserId;
    }
    if (typeof extra.slaEnabled === 'boolean') {
      slaEnabled = extra.slaEnabled;
    }
    if (typeof extra.slaFirstResponseMinutes === 'number' && extra.slaFirstResponseMinutes > 0) {
      slaFirstResponseMinutes = extra.slaFirstResponseMinutes;
    }
    if (typeof extra.slaEscalateMinutes === 'number' && extra.slaEscalateMinutes > 0) {
      slaEscalateMinutes = extra.slaEscalateMinutes;
    }
  }

  // Resolve the last-assigned user's name, if any. Pure lookup; if the row is
  // gone we just leave the name null.
  let lastAssignedUserName: string | null = null;
  if (lastAssignedUserId) {
    const { data: userRow } = await supabase
      .from('User')
      .select('name, email')
      .eq('id', lastAssignedUserId)
      .maybeSingle<{ name: string | null; email: string | null }>();
    if (userRow) {
      lastAssignedUserName = userRow.name?.trim() || userRow.email || null;
    }
  }

  // Count active reps (rep_member rows) for the team. Safe to run
  // always — this table is not gated on BP7a.
  const { count } = await supabase
    .from('TeamMembership')
    .select('id', { count: 'exact', head: true })
    .eq('teamId', teamId)
    .eq('role', 'rep_member');

  return {
    autoAssignEnabled,
    assignmentMethod,
    lastAssignedUserId,
    lastAssignedUserName,
    repMemberCount: typeof count === 'number' ? count : 0,
    slaEnabled,
    slaFirstResponseMinutes,
    slaEscalateMinutes,
  };
}

/**
 * GET /api/manager/settings
 * Returns current team settings.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const auto = await resolveAutoAssignMeta(ctx.team.id);

  const response: SettingsResponse = {
    id: ctx.team.id,
    name: ctx.team.name,
    websiteUrl: ctx.team.websiteUrl,
    logoUrl: ctx.team.logoUrl,
    status: ctx.team.status,
    privacyPolicyHtml: ctx.team.privacyPolicyHtml ?? null,
    autoAssignEnabled: auto.autoAssignEnabled,
    assignmentMethod: auto.assignmentMethod,
    lastAssignedUserId: auto.lastAssignedUserId,
    lastAssignedUserName: auto.lastAssignedUserName,
    repMemberCount: auto.repMemberCount,
    slaEnabled: auto.slaEnabled,
    slaFirstResponseMinutes: auto.slaFirstResponseMinutes,
    slaEscalateMinutes: auto.slaEscalateMinutes,
    teamLicenseNumber: ctx.team.teamLicenseNumber ?? null,
    teamFairHousingNotice: ctx.team.teamFairHousingNotice ?? null,
    teamShowEqualHousingMark: ctx.team.teamShowEqualHousingMark ?? false,
  };

  return NextResponse.json(response);
}

/**
 * PATCH /api/manager/settings
 * Update team settings. Owner or admin can update.
 */
export async function PATCH(req: Request) {
  const { userId: clerkId } = await auth();
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!canEditSettings(ctx.membership.role)) {
    return NextResponse.json({ error: 'Only the owner or admins can update settings' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // Name
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    updates.name = name;
  }

  // Website URL
  if (body.websiteUrl !== undefined) {
    if (body.websiteUrl === null || body.websiteUrl === '') {
      updates.websiteUrl = null;
    } else if (typeof body.websiteUrl === 'string') {
      const url = body.websiteUrl.trim().slice(0, 500);
      if (url && !/^https?:\/\/.+/i.test(url)) {
        return NextResponse.json({ error: 'Website URL must start with http:// or https://' }, { status: 400 });
      }
      updates.websiteUrl = url || null;
    }
  }

  // Logo URL
  if (body.logoUrl !== undefined) {
    if (body.logoUrl === null || body.logoUrl === '') {
      updates.logoUrl = null;
    } else if (typeof body.logoUrl === 'string') {
      const url = body.logoUrl.trim().slice(0, 500);
      if (url && !/^https?:\/\/.+/i.test(url)) {
        return NextResponse.json({ error: 'Logo URL must start with http:// or https://' }, { status: 400 });
      }
      updates.logoUrl = url || null;
    }
  }

  // Privacy Policy HTML
  if (body.privacyPolicyHtml !== undefined) {
    if (body.privacyPolicyHtml === null || body.privacyPolicyHtml === '') {
      updates.privacyPolicyHtml = null;
    } else if (typeof body.privacyPolicyHtml === 'string') {
      // Cap at 100KB to prevent storage abuse
      updates.privacyPolicyHtml = body.privacyPolicyHtml.slice(0, 100_000);
    }
  }

  // Auto-assignment — BP7a. Each field is independent; if only one is provided
  // we only update that one, leaving the other column untouched.
  if (body.autoAssignEnabled !== undefined) {
    if (typeof body.autoAssignEnabled !== 'boolean') {
      return NextResponse.json({ error: 'autoAssignEnabled must be a boolean' }, { status: 400 });
    }
    updates.autoAssignEnabled = body.autoAssignEnabled;
  }

  // Trust signals — three optional compliance slots rendered in the
  // team intake footer. Each independent; missing keys leave the
  // existing column untouched.
  if (body.teamLicenseNumber !== undefined) {
    if (body.teamLicenseNumber === null || body.teamLicenseNumber === '') {
      updates.teamLicenseNumber = null;
    } else if (typeof body.teamLicenseNumber === 'string') {
      updates.teamLicenseNumber = body.teamLicenseNumber.trim().slice(0, 200) || null;
    }
  }
  if (body.teamFairHousingNotice !== undefined) {
    if (body.teamFairHousingNotice === null || body.teamFairHousingNotice === '') {
      updates.teamFairHousingNotice = null;
    } else if (typeof body.teamFairHousingNotice === 'string') {
      updates.teamFairHousingNotice = body.teamFairHousingNotice.slice(0, 2000) || null;
    }
  }
  if (body.teamShowEqualHousingMark !== undefined) {
    if (typeof body.teamShowEqualHousingMark !== 'boolean') {
      return NextResponse.json({ error: 'teamShowEqualHousingMark must be a boolean' }, { status: 400 });
    }
    updates.teamShowEqualHousingMark = body.teamShowEqualHousingMark;
  }

  if (body.assignmentMethod !== undefined) {
    if (
      typeof body.assignmentMethod !== 'string' ||
      !(ASSIGNMENT_METHODS as readonly string[]).includes(body.assignmentMethod)
    ) {
      return NextResponse.json(
        { error: 'assignmentMethod must be one of: manual, round_robin, score_based' },
        { status: 400 }
      );
    }
    updates.assignmentMethod = body.assignmentMethod;
  }

  // Speed-to-lead SLA controls.
  if (body.slaEnabled !== undefined) {
    if (typeof body.slaEnabled !== 'boolean') {
      return NextResponse.json({ error: 'slaEnabled must be a boolean' }, { status: 400 });
    }
    updates.slaEnabled = body.slaEnabled;
  }

  if (body.slaFirstResponseMinutes !== undefined) {
    const v = body.slaFirstResponseMinutes;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 5 || v > 1440) {
      return NextResponse.json(
        { error: 'slaFirstResponseMinutes must be an integer between 5 and 1440' },
        { status: 400 }
      );
    }
    updates.slaFirstResponseMinutes = v;
  }

  if (body.slaEscalateMinutes !== undefined) {
    const v = body.slaEscalateMinutes;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 5 || v > 1440) {
      return NextResponse.json(
        { error: 'slaEscalateMinutes must be an integer between 5 and 1440' },
        { status: 400 }
      );
    }
    // Cross-field: escalate must be >= first-response. Compare against the
    // value in this same request when both are supplied, else trust client
    // validation — the enforcement engine also guards it at runtime.
    const firstRef =
      typeof body.slaFirstResponseMinutes === 'number'
        ? (body.slaFirstResponseMinutes as number)
        : null;
    if (firstRef !== null && v < firstRef) {
      return NextResponse.json(
        { error: 'slaEscalateMinutes must be greater than or equal to slaFirstResponseMinutes' },
        { status: 400 }
      );
    }
    updates.slaEscalateMinutes = v;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from('Team')
    .update(updates)
    .eq('id', ctx.team.id);

  if (updateErr) {
    console.error('[manager/settings] update failed', updateErr);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'Team',
    resourceId: ctx.team.id,
    metadata: { updates },
  });

  // Return the freshly-updated settings row in the same shape as GET, so the
  // UI can swap in the response without a round-trip refetch.
  const auto = await resolveAutoAssignMeta(ctx.team.id);
  const { data: team } = await supabase
    .from('Team')
    .select(
      'id, name, websiteUrl, logoUrl, status, privacyPolicyHtml, ' +
      'teamLicenseNumber, teamFairHousingNotice, teamShowEqualHousingMark'
    )
    .eq('id', ctx.team.id)
    .maybeSingle<{
      id: string;
      name: string;
      websiteUrl: string | null;
      logoUrl: string | null;
      status: 'active' | 'suspended';
      privacyPolicyHtml: string | null;
      teamLicenseNumber: string | null;
      teamFairHousingNotice: string | null;
      teamShowEqualHousingMark: boolean | null;
    }>();

  const response: SettingsResponse = {
    id: team?.id ?? ctx.team.id,
    name: team?.name ?? ctx.team.name,
    websiteUrl: team?.websiteUrl ?? ctx.team.websiteUrl,
    logoUrl: team?.logoUrl ?? ctx.team.logoUrl,
    status: team?.status ?? ctx.team.status,
    privacyPolicyHtml: team?.privacyPolicyHtml ?? ctx.team.privacyPolicyHtml ?? null,
    autoAssignEnabled: auto.autoAssignEnabled,
    assignmentMethod: auto.assignmentMethod,
    lastAssignedUserId: auto.lastAssignedUserId,
    lastAssignedUserName: auto.lastAssignedUserName,
    repMemberCount: auto.repMemberCount,
    slaEnabled: auto.slaEnabled,
    slaFirstResponseMinutes: auto.slaFirstResponseMinutes,
    slaEscalateMinutes: auto.slaEscalateMinutes,
    teamLicenseNumber: team?.teamLicenseNumber ?? ctx.team.teamLicenseNumber ?? null,
    teamFairHousingNotice: team?.teamFairHousingNotice ?? ctx.team.teamFairHousingNotice ?? null,
    teamShowEqualHousingMark: team?.teamShowEqualHousingMark ?? ctx.team.teamShowEqualHousingMark ?? false,
  };

  return NextResponse.json(response);
}
