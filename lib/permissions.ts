/**
 * Central permission helpers for the org/role system.
 *
 * Three account levels:
 *   1. Realtor (default) — solo workspace owner
 *   2. Broker — has a BrokerageMembership with role broker_owner or broker_admin
 *   3. Platform Admin — User.platformRole = 'admin' (or Clerk metadata fallback)
 *
 * Always use these helpers in API routes, server actions, and layouts.
 * Never scatter raw role checks across the codebase.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import type { Brokerage, BrokerageMembership } from '@/lib/types';

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
  // Same offboarding gate as getBrokerContext()/requireAuth(): an offboarded
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

// ── Broker ────────────────────────────────────────────────────────────────────

type BrokerContext = {
  brokerage: Brokerage;
  membership: BrokerageMembership;
  dbUserId: string;
};

/**
 * Returns the brokerage + membership for the current user if they are a broker
 * (role = broker_owner or broker_admin), or null if they are not.
 */
export async function getBrokerContext(): Promise<BrokerContext | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data: user } = await supabase
    .from('User')
    .select('id, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  if (!user) return null;
  // Same offboarding gate as requireAuth(). Broker routes use this helper
  // (or getBrokerMemberContext below) without going through requireAuth,
  // so the gate has to live here too — otherwise an offboarded user's
  // broker-scoped sessions would keep working until their membership row
  // eventually fell out of the DB. Resilient to a missing `status` column
  // pre-BP1a migration: maybeSingle() returns { status: undefined } which
  // is not === 'offboarded'.
  if ((user as { status?: string }).status === 'offboarded') return null;

  // Fetch all broker-level memberships. A user may own one brokerage and
  // manage another — prefer broker_owner so they always land on their own brokerage.
  const { data: memberships } = await supabase
    .from('BrokerageMembership')
    .select('*')
    .eq('userId', user.id)
    .in('role', ['broker_owner', 'broker_admin'])
    .order('createdAt', { ascending: true });
  if (!memberships?.length) return null;

  // Deterministic pick for a user who is a broker at more than one brokerage:
  // broker_owner first, then broker_admin, oldest within a tier (query ordered
  // by createdAt). The old `?? memberships[0]` fell back to PostgREST insertion
  // order, so the same user could resolve to a different brokerage run-to-run
  // and act on the wrong one.
  const membership =
    memberships.find((m) => m.role === 'broker_owner') ??
    memberships.find((m) => m.role === 'broker_admin') ??
    memberships[0];

  const { data: brokerage } = await supabase
    .from('Brokerage')
    .select('*')
    .eq('id', membership.brokerageId)
    .maybeSingle();
  if (!brokerage) return null;

  return {
    brokerage: brokerage as Brokerage,
    membership: membership as BrokerageMembership,
    dbUserId: user.id,
  };
}

/**
 * Require broker access. Throws if the current user is not a broker.
 */
export async function requireBroker(): Promise<BrokerContext> {
  const ctx = await getBrokerContext();
  if (!ctx) throw new Error('Forbidden: broker access required');
  return ctx;
}

/**
 * Returns the brokerage + membership for the current user if they have ANY
 * brokerage membership (including realtor_member). Use this for pages that
 * are accessible to all brokerage members, not just admins/owners.
 */
export async function getBrokerMemberContext(): Promise<BrokerContext | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data: user } = await supabase
    .from('User')
    .select('id, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  if (!user) return null;
  // Offboarding gate — see getBrokerContext above for rationale.
  if ((user as { status?: string }).status === 'offboarded') return null;

  const { data: memberships } = await supabase
    .from('BrokerageMembership')
    .select('*')
    .eq('userId', user.id)
    .in('role', ['broker_owner', 'broker_admin', 'realtor_member'])
    .order('createdAt', { ascending: true });
  if (!memberships?.length) return null;

  // Prefer broker_owner > broker_admin > realtor_member, oldest within a tier
  // (query ordered by createdAt) so a multi-brokerage user resolves
  // deterministically instead of by PostgREST insertion order.
  const membership =
    memberships.find((m) => m.role === 'broker_owner') ??
    memberships.find((m) => m.role === 'broker_admin') ??
    memberships.find((m) => m.role === 'realtor_member') ??
    memberships[0];

  const { data: brokerage } = await supabase
    .from('Brokerage')
    .select('*')
    .eq('id', membership.brokerageId)
    .maybeSingle();
  if (!brokerage) return null;

  return {
    brokerage: brokerage as Brokerage,
    membership: membership as BrokerageMembership,
    dbUserId: user.id,
  };
}

// ── Role-based permission helpers ─────────────────────────────────────────────

/** Roles that can manage leads (assign, reassign, delete) */
const LEAD_MANAGEMENT_ROLES = ['broker_owner', 'broker_admin'] as const;

/** Roles that can edit brokerage settings */
const SETTINGS_EDIT_ROLES = ['broker_owner', 'broker_admin'] as const;

/** Roles that can manage member roles (promote/demote) */
const ROLE_MANAGEMENT_ROLES = ['broker_owner', 'broker_admin'] as const;

/**
 * Check if a broker membership role can manage leads (assign, reassign).
 * Only broker_owner and broker_admin can assign leads.
 * realtor_member can only view leads assigned to them.
 */
export function canManageLeads(role: string): boolean {
  return (LEAD_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a broker membership role can edit brokerage settings.
 */
export function canEditSettings(role: string): boolean {
  return (SETTINGS_EDIT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a broker membership role can change other members' roles.
 */
export function canManageRoles(role: string): boolean {
  return (ROLE_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a user with the given role can change the target member's role.
 * - broker_owner can change any non-owner role
 * - broker_admin can promote realtor_member to broker_admin, but cannot demote other admins
 */
export function canChangeRole(actorRole: string, targetCurrentRole: string): boolean {
  if (targetCurrentRole === 'broker_owner') return false;
  if (actorRole === 'broker_owner') return true;
  if (actorRole === 'broker_admin' && targetCurrentRole === 'realtor_member') return true;
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
