/**
 * Central permission helpers for the org/role system.
 *
 * Three account levels:
 *   1. Rep (default) — solo workspace owner
 *   2. Manager — has a TeamMembership with role manager_owner or manager_admin
 *   3. Platform Admin — User.platformRole = 'admin' (or Clerk metadata fallback)
 *
 * Always use these helpers in API routes, server actions, and layouts.
 * Never scatter raw role checks across the codebase.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import type { Team, TeamMembership } from '@/lib/types';

// ── Platform admin ────────────────────────────────────────────────────────────

/**
 * Returns true if the current Clerk user is a platform admin.
 * Only check: User.platformRole = 'admin' in DB (single source of truth).
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session.userId) return false;

  // Authoritative check in DB — the single source of truth for admin role
  const { data } = await supabase
    .from('User')
    .select('platformRole, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  // Same offboarding gate as getManagerContext()/requireAuth(): an offboarded
  // user loses admin access immediately, not when their Clerk session expires.
  // Resilient to a missing `status` column (pre-BP1a): undefined !== 'offboarded'.
  if ((data as { status?: string } | null)?.status === 'offboarded') return false;
  return data?.platformRole === 'admin';
}

/**
 * Require platform admin access. Throws if not admin.
 * Use at the top of admin route handlers and server components.
 */
export async function requirePlatformAdmin(): Promise<{ clerkUserId: string }> {
  const session = await auth();
  if (!session.userId) throw new Error('Forbidden: not authenticated');

  const ok = await isPlatformAdmin();
  if (!ok) throw new Error('Forbidden: platform admin access required');

  return { clerkUserId: session.userId };
}

// ── Manager ────────────────────────────────────────────────────────────────────

type ManagerContext = {
  team: Team;
  membership: TeamMembership;
  dbUserId: string;
};

/**
 * Returns the team + membership for the current user if they are a manager
 * (role = manager_owner or manager_admin), or null if they are not.
 */
export async function getManagerContext(): Promise<ManagerContext | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data: user } = await supabase
    .from('User')
    .select('id, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  if (!user) return null;
  // Same offboarding gate as requireAuth(). Manager routes use this helper
  // (or getManagerMemberContext below) without going through requireAuth,
  // so the gate has to live here too — otherwise an offboarded user's
  // manager-scoped sessions would keep working until their membership row
  // eventually fell out of the DB. Resilient to a missing `status` column
  // pre-BP1a migration: maybeSingle() returns { status: undefined } which
  // is not === 'offboarded'.
  if ((user as { status?: string }).status === 'offboarded') return null;

  // Fetch all manager-level memberships. A user may own one team and
  // manage another — prefer manager_owner so they always land on their own team.
  const { data: memberships } = await supabase
    .from('TeamMembership')
    .select('*')
    .eq('userId', user.id)
    .in('role', ['manager_owner', 'manager_admin'])
    .order('createdAt', { ascending: true });
  if (!memberships?.length) return null;

  // Deterministic pick for a user who is a manager at more than one team:
  // manager_owner first, then manager_admin, oldest within a tier (query ordered
  // by createdAt). The old `?? memberships[0]` fell back to PostgREST insertion
  // order, so the same user could resolve to a different team run-to-run
  // and act on the wrong one.
  const membership =
    memberships.find((m) => m.role === 'manager_owner') ??
    memberships.find((m) => m.role === 'manager_admin') ??
    memberships[0];

  const { data: team } = await supabase
    .from('Team')
    .select('*')
    .eq('id', membership.teamId)
    .maybeSingle();
  if (!team) return null;

  return {
    team: team as Team,
    membership: membership as TeamMembership,
    dbUserId: user.id,
  };
}

/**
 * Require manager access. Throws if the current user is not a manager.
 */
export async function requireManager(): Promise<ManagerContext> {
  const ctx = await getManagerContext();
  if (!ctx) throw new Error('Forbidden: manager access required');
  return ctx;
}

/**
 * Returns the team + membership for the current user if they have ANY
 * team membership (including rep_member). Use this for pages that
 * are accessible to all team members, not just admins/owners.
 */
export async function getManagerMemberContext(): Promise<ManagerContext | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data: user } = await supabase
    .from('User')
    .select('id, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  if (!user) return null;
  // Offboarding gate — see getManagerContext above for rationale.
  if ((user as { status?: string }).status === 'offboarded') return null;

  const { data: memberships } = await supabase
    .from('TeamMembership')
    .select('*')
    .eq('userId', user.id)
    .in('role', ['manager_owner', 'manager_admin', 'rep_member'])
    .order('createdAt', { ascending: true });
  if (!memberships?.length) return null;

  // Prefer manager_owner > manager_admin > rep_member, oldest within a tier
  // (query ordered by createdAt) so a multi-team user resolves
  // deterministically instead of by PostgREST insertion order.
  const membership =
    memberships.find((m) => m.role === 'manager_owner') ??
    memberships.find((m) => m.role === 'manager_admin') ??
    memberships.find((m) => m.role === 'rep_member') ??
    memberships[0];

  const { data: team } = await supabase
    .from('Team')
    .select('*')
    .eq('id', membership.teamId)
    .maybeSingle();
  if (!team) return null;

  return {
    team: team as Team,
    membership: membership as TeamMembership,
    dbUserId: user.id,
  };
}

// ── Role-based permission helpers ─────────────────────────────────────────────

/** Roles that can manage leads (assign, reassign, delete) */
const LEAD_MANAGEMENT_ROLES = ['manager_owner', 'manager_admin'] as const;

/** Roles that can edit team settings */
const SETTINGS_EDIT_ROLES = ['manager_owner', 'manager_admin'] as const;

/** Roles that can manage member roles (promote/demote) */
const ROLE_MANAGEMENT_ROLES = ['manager_owner', 'manager_admin'] as const;

/**
 * Check if a manager membership role can manage leads (assign, reassign).
 * Only manager_owner and manager_admin can assign leads.
 * rep_member can only view leads assigned to them.
 */
export function canManageLeads(role: string): boolean {
  return (LEAD_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a manager membership role can edit team settings.
 */
export function canEditSettings(role: string): boolean {
  return (SETTINGS_EDIT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a manager membership role can change other members' roles.
 */
export function canManageRoles(role: string): boolean {
  return (ROLE_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a user with the given role can change the target member's role.
 * - manager_owner can change any non-owner role
 * - manager_admin can promote rep_member to manager_admin, but cannot demote other admins
 */
export function canChangeRole(actorRole: string, targetCurrentRole: string): boolean {
  if (targetCurrentRole === 'manager_owner') return false;
  if (actorRole === 'manager_owner') return true;
  if (actorRole === 'manager_admin' && targetCurrentRole === 'rep_member') return true;
  return false;
}

// ── Shared auth helper ────────────────────────────────────────────────────────

/**
 * Resolve the current Clerk user to their internal User row.
 * Returns null if not authenticated or not in DB.
 */
export async function getCurrentDbUser(): Promise<{ id: string; clerkId: string } | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data } = await supabase
    .from('User')
    .select('id, clerkId')
    .eq('clerkId', session.userId)
    .maybeSingle();
  return data ?? null;
}
