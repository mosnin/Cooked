import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireBroker, canEditSettings } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';

type AssignmentMethod = 'manual' | 'round_robin' | 'score_based';

const ASSIGNMENT_METHODS: readonly AssignmentMethod[] = [
  'manual',
  'round_robin',
  'score_based',
];

type BrokerageAutoAssignFields = {
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
  realtorMemberCount: number;
  slaEnabled: boolean;
  slaFirstResponseMinutes: number;
  slaEscalateMinutes: number;
  brokerageLicenseNumber: string | null;
  brokerageFairHousingNotice: string | null;
  brokerageShowEqualHousingMark: boolean;
};

/**
 * Resolve the auto-assignment metadata for a brokerage. Resilient to the
 * underlying columns not existing yet (pre-BP7a migration) — in that case we
 * fall back to disabled/manual with no cursor.
 */
async function resolveAutoAssignMeta(brokerageId: string): Promise<{
  autoAssignEnabled: boolean;
  assignmentMethod: AssignmentMethod;
  lastAssignedUserId: string | null;
  lastAssignedUserName: string | null;
  realtorMemberCount: number;
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
  // yet), we keep the defaults above — the page stays usable for every broker.
  const { data: extra, error: extraErr } = await supabase
    .from('Brokerage')
    .select(
      'autoAssignEnabled, assignmentMethod, lastAssignedUserId, ' +
      'slaEnabled, slaFirstResponseMinutes, slaEscalateMinutes'
    )
    .eq('id', brokerageId)
    .maybeSingle<BrokerageAutoAssignFields>();

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

  // Count active realtors (realtor_member rows) for the brokerage. Safe to run
  // always — this table is not gated on BP7a.
  const { count } = await supabase
    .from('BrokerageMembership')
    .select('id', { count: 'exact', head: true })
    .eq('brokerageId', brokerageId)
    .eq('role', 'realtor_member');

  return {
    autoAssignEnabled,
    assignmentMethod,
    lastAssignedUserId,
    lastAssignedUserName,
    realtorMemberCount: typeof count === 'number' ? count : 0,
    slaEnabled,
    slaFirstResponseMinutes,
    slaEscalateMinutes,
  };
}

/**
 * GET /api/broker/settings
 * Returns current brokerage settings.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const auto = await resolveAutoAssignMeta(ctx.brokerage.id);

  const response: SettingsResponse = {
    id: ctx.brokerage.id,
    name: ctx.brokerage.name,
    websiteUrl: ctx.brokerage.websiteUrl,
    logoUrl: ctx.brokerage.logoUrl,
    status: ctx.brokerage.status,
    privacyPolicyHtml: ctx.brokerage.privacyPolicyHtml ?? null,
    autoAssignEnabled: auto.autoAssignEnabled,
    assignmentMethod: auto.assignmentMethod,
    lastAssignedUserId: auto.lastAssignedUserId,
    lastAssignedUserName: auto.lastAssignedUserName,
    realtorMemberCount: auto.realtorMemberCount,
    slaEnabled: auto.slaEnabled,
    slaFirstResponseMinutes: auto.slaFirstResponseMinutes,
    slaEscalateMinutes: auto.slaEscalateMinutes,
    brokerageLicenseNumber: ctx.brokerage.brokerageLicenseNumber ?? null,
    brokerageFairHousingNotice: ctx.brokerage.brokerageFairHousingNotice ?? null,
    brokerageShowEqualHousingMark: ctx.brokerage.brokerageShowEqualHousingMark ?? false,
  };

  return NextResponse.json(response);
}

/**
 * PATCH /api/broker/settings
 * Update brokerage settings. Owner or admin can update.
 */
export async function PATCH(req: Request) {
  const { userId: clerkId } = await auth();
  let ctx;
  try {
    ctx = await requireBroker();
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
  // brokerage intake footer. Each independent; missing keys leave the
  // existing column untouched.
  if (body.brokerageLicenseNumber !== undefined) {
    if (body.brokerageLicenseNumber === null || body.brokerageLicenseNumber === '') {
      updates.brokerageLicenseNumber = null;
    } else if (typeof body.brokerageLicenseNumber === 'string') {
      updates.brokerageLicenseNumber = body.brokerageLicenseNumber.trim().slice(0, 200) || null;
    }
  }
  if (body.brokerageFairHousingNotice !== undefined) {
    if (body.brokerageFairHousingNotice === null || body.brokerageFairHousingNotice === '') {
      updates.brokerageFairHousingNotice = null;
    } else if (typeof body.brokerageFairHousingNotice === 'string') {
      updates.brokerageFairHousingNotice = body.brokerageFairHousingNotice.slice(0, 2000) || null;
    }
  }
  if (body.brokerageShowEqualHousingMark !== undefined) {
    if (typeof body.brokerageShowEqualHousingMark !== 'boolean') {
      return NextResponse.json({ error: 'brokerageShowEqualHousingMark must be a boolean' }, { status: 400 });
    }
    updates.brokerageShowEqualHousingMark = body.brokerageShowEqualHousingMark;
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
    .from('Brokerage')
    .update(updates)
    .eq('id', ctx.brokerage.id);

  if (updateErr) {
    console.error('[broker/settings] update failed', updateErr);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'Brokerage',
    resourceId: ctx.brokerage.id,
    metadata: { updates },
  });

  // Return the freshly-updated settings row in the same shape as GET, so the
  // UI can swap in the response without a round-trip refetch.
  const auto = await resolveAutoAssignMeta(ctx.brokerage.id);
  const { data: brokerage } = await supabase
    .from('Brokerage')
    .select(
      'id, name, websiteUrl, logoUrl, status, privacyPolicyHtml, ' +
      'brokerageLicenseNumber, brokerageFairHousingNotice, brokerageShowEqualHousingMark'
    )
    .eq('id', ctx.brokerage.id)
    .maybeSingle<{
      id: string;
      name: string;
      websiteUrl: string | null;
      logoUrl: string | null;
      status: 'active' | 'suspended';
      privacyPolicyHtml: string | null;
      brokerageLicenseNumber: string | null;
      brokerageFairHousingNotice: string | null;
      brokerageShowEqualHousingMark: boolean | null;
    }>();

  const response: SettingsResponse = {
    id: brokerage?.id ?? ctx.brokerage.id,
    name: brokerage?.name ?? ctx.brokerage.name,
    websiteUrl: brokerage?.websiteUrl ?? ctx.brokerage.websiteUrl,
    logoUrl: brokerage?.logoUrl ?? ctx.brokerage.logoUrl,
    status: brokerage?.status ?? ctx.brokerage.status,
    privacyPolicyHtml: brokerage?.privacyPolicyHtml ?? ctx.brokerage.privacyPolicyHtml ?? null,
    autoAssignEnabled: auto.autoAssignEnabled,
    assignmentMethod: auto.assignmentMethod,
    lastAssignedUserId: auto.lastAssignedUserId,
    lastAssignedUserName: auto.lastAssignedUserName,
    realtorMemberCount: auto.realtorMemberCount,
    slaEnabled: auto.slaEnabled,
    slaFirstResponseMinutes: auto.slaFirstResponseMinutes,
    slaEscalateMinutes: auto.slaEscalateMinutes,
    brokerageLicenseNumber: brokerage?.brokerageLicenseNumber ?? ctx.brokerage.brokerageLicenseNumber ?? null,
    brokerageFairHousingNotice: brokerage?.brokerageFairHousingNotice ?? ctx.brokerage.brokerageFairHousingNotice ?? null,
    brokerageShowEqualHousingMark: brokerage?.brokerageShowEqualHousingMark ?? ctx.brokerage.brokerageShowEqualHousingMark ?? false,
  };

  return NextResponse.json(response);
}
