/**
 * DB-side helpers for TeamIntegrationConnection rows — the team
 * analogue of connections.ts. Composio holds the OAuth tokens; this table
 * holds the pointer + status + audit. One active row per
 * (team, user, toolkit) — a reconnect flips the prior row to 'revoked'
 * and inserts a new 'active' row.
 *
 * Scoped by teamId + the Clerk userId of the admin/owner who connected,
 * so two admins can each connect their OWN Gmail at the team level
 * without colliding. The Composio plumbing (initiate / get / delete) is NOT
 * forked — it lives in composio.ts and is shared with the rep flow. Only
 * storage and scoping differ here.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { deleteConnection as composioDelete } from './composio';

export type TeamIntegrationStatus = 'active' | 'expired' | 'revoked' | 'failed';

export interface TeamIntegrationConnectionRow {
  id: string;
  teamId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  status: TeamIntegrationStatus;
  label: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** All connections for a team, regardless of status. UI filters as needed. */
export async function listTeamConnections(
  teamId: string,
): Promise<TeamIntegrationConnectionRow[]> {
  const { data, error } = await supabase
    .from('TeamIntegrationConnection')
    .select('*')
    .eq('teamId', teamId)
    .order('createdAt', { ascending: false });
  if (error) {
    logger.warn('[integrations.team-connections] list failed', {
      teamId,
      err: error.message,
    });
    return [];
  }
  return (data ?? []) as TeamIntegrationConnectionRow[];
}

/**
 * Connections for a single (team, user). The team integrations
 * panel shows each admin only their OWN connected accounts — they connect
 * with their own OAuth grants, so they manage their own rows.
 */
export async function listTeamConnectionsForUser(args: {
  teamId: string;
  userId: string;
}): Promise<TeamIntegrationConnectionRow[]> {
  const { data, error } = await supabase
    .from('TeamIntegrationConnection')
    .select('*')
    .eq('teamId', args.teamId)
    .eq('userId', args.userId)
    .order('createdAt', { ascending: false });
  if (error) {
    logger.warn('[integrations.team-connections] listForUser failed', {
      teamId: args.teamId,
      err: error.message,
    });
    return [];
  }
  return (data ?? []) as TeamIntegrationConnectionRow[];
}

/** Look up by composio connection id — used by the OAuth callback. */
export async function findTeamByComposioId(composioConnectionId: string) {
  const { data } = await supabase
    .from('TeamIntegrationConnection')
    .select('*')
    .eq('composioConnectionId', composioConnectionId)
    .maybeSingle();
  return (data ?? null) as TeamIntegrationConnectionRow | null;
}

/** Look up by our own row id. */
export async function getTeamConnectionById(id: string) {
  const { data } = await supabase
    .from('TeamIntegrationConnection')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as TeamIntegrationConnectionRow | null;
}

/** Find any active row for this (team, user, toolkit). */
export async function findActiveTeamConnection(args: {
  teamId: string;
  userId: string;
  toolkit: string;
}): Promise<TeamIntegrationConnectionRow | null> {
  const { data } = await supabase
    .from('TeamIntegrationConnection')
    .select('*')
    .eq('teamId', args.teamId)
    .eq('userId', args.userId)
    .eq('toolkit', args.toolkit)
    .eq('status', 'active')
    .maybeSingle();
  return (data ?? null) as TeamIntegrationConnectionRow | null;
}

/**
 * Insert a new connection row. Caller is responsible for revoking any prior
 * active row for the same (team, user, toolkit) BEFORE calling this —
 * the unique-active index will reject otherwise.
 */
export async function insertTeamConnection(args: {
  teamId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  label?: string;
}): Promise<TeamIntegrationConnectionRow | null> {
  const { data, error } = await supabase
    .from('TeamIntegrationConnection')
    .insert({
      teamId: args.teamId,
      userId: args.userId,
      toolkit: args.toolkit,
      composioConnectionId: args.composioConnectionId,
      label: args.label ?? null,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) {
    logger.error('[integrations.team-connections] insert failed', {
      teamId: args.teamId,
      userId: args.userId,
      toolkit: args.toolkit,
      composioConnectionId: args.composioConnectionId,
      hasLabel: Boolean(args.label),
      errCode: (error as { code?: string }).code ?? null,
      errMessage: error.message,
      errDetails: (error as { details?: string }).details ?? null,
      errHint: (error as { hint?: string }).hint ?? null,
    });
    return null;
  }
  return data as TeamIntegrationConnectionRow;
}

/**
 * Upsert by `composioConnectionId`. Used by the OAuth callback: the connect
 * route persists the row at initiate-time, so the callback updates the label
 * (Composio surfaces the connected user's email after OAuth completes) and
 * bumps status back to 'active' if it drifted. Falls back to insert if the
 * row somehow doesn't exist.
 */
export async function upsertTeamByComposioId(args: {
  teamId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  label?: string;
}): Promise<TeamIntegrationConnectionRow | null> {
  const existing = await findTeamByComposioId(args.composioConnectionId);
  if (existing) {
    const { error } = await supabase
      .from('TeamIntegrationConnection')
      .update({
        label: args.label ?? existing.label ?? null,
        status: 'active',
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      logger.error('[integrations.team-connections] upsertByComposioId update failed', {
        id: existing.id,
        errCode: (error as { code?: string }).code ?? null,
        errMessage: error.message,
      });
      return null;
    }
    return {
      ...existing,
      label: args.label ?? existing.label ?? null,
      status: 'active',
      lastError: null,
    };
  }
  return insertTeamConnection(args);
}

/** Flip a row's status. Used for reconnect (prior → revoked) and on errors. */
export async function setTeamConnectionStatus(args: {
  id: string;
  status: TeamIntegrationStatus;
  lastError?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('TeamIntegrationConnection')
    .update({
      status: args.status,
      lastError: args.lastError ?? null,
      updatedAt: new Date().toISOString(),
    })
    .eq('id', args.id);
  if (error) {
    logger.warn('[integrations.team-connections] setStatus failed', {
      id: args.id,
      err: error.message,
    });
  }
}

/**
 * Revoke at Composio AND mark our row revoked. Idempotent. Team-level
 * connections don't register curated triggers (no inbound-event wiring at the
 * team level yet), so this is a straight delete-then-mark — no trigger
 * cleanup step like the rep revoke path.
 */
export async function revokeTeamConnection(
  row: TeamIntegrationConnectionRow,
): Promise<void> {
  await composioDelete(row.composioConnectionId);
  await setTeamConnectionStatus({ id: row.id, status: 'revoked' });
}
