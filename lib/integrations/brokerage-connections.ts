/**
 * DB-side helpers for BrokerageIntegrationConnection rows — the brokerage
 * analogue of connections.ts. Composio holds the OAuth tokens; this table
 * holds the pointer + status + audit. One active row per
 * (brokerage, user, toolkit) — a reconnect flips the prior row to 'revoked'
 * and inserts a new 'active' row.
 *
 * Scoped by brokerageId + the Clerk userId of the admin/owner who connected,
 * so two admins can each connect their OWN Gmail at the brokerage level
 * without colliding. The Composio plumbing (initiate / get / delete) is NOT
 * forked — it lives in composio.ts and is shared with the realtor flow. Only
 * storage and scoping differ here.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { deleteConnection as composioDelete } from './composio';

export type BrokerageIntegrationStatus = 'active' | 'expired' | 'revoked' | 'failed';

export interface BrokerageIntegrationConnectionRow {
  id: string;
  brokerageId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  status: BrokerageIntegrationStatus;
  label: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** All connections for a brokerage, regardless of status. UI filters as needed. */
export async function listBrokerageConnections(
  brokerageId: string,
): Promise<BrokerageIntegrationConnectionRow[]> {
  const { data, error } = await supabase
    .from('BrokerageIntegrationConnection')
    .select('*')
    .eq('brokerageId', brokerageId)
    .order('createdAt', { ascending: false });
  if (error) {
    logger.warn('[integrations.brokerage-connections] list failed', {
      brokerageId,
      err: error.message,
    });
    return [];
  }
  return (data ?? []) as BrokerageIntegrationConnectionRow[];
}

/**
 * Connections for a single (brokerage, user). The brokerage integrations
 * panel shows each admin only their OWN connected accounts — they connect
 * with their own OAuth grants, so they manage their own rows.
 */
export async function listBrokerageConnectionsForUser(args: {
  brokerageId: string;
  userId: string;
}): Promise<BrokerageIntegrationConnectionRow[]> {
  const { data, error } = await supabase
    .from('BrokerageIntegrationConnection')
    .select('*')
    .eq('brokerageId', args.brokerageId)
    .eq('userId', args.userId)
    .order('createdAt', { ascending: false });
  if (error) {
    logger.warn('[integrations.brokerage-connections] listForUser failed', {
      brokerageId: args.brokerageId,
      err: error.message,
    });
    return [];
  }
  return (data ?? []) as BrokerageIntegrationConnectionRow[];
}

/** Look up by composio connection id — used by the OAuth callback. */
export async function findBrokerageByComposioId(composioConnectionId: string) {
  const { data } = await supabase
    .from('BrokerageIntegrationConnection')
    .select('*')
    .eq('composioConnectionId', composioConnectionId)
    .maybeSingle();
  return (data ?? null) as BrokerageIntegrationConnectionRow | null;
}

/** Look up by our own row id. */
export async function getBrokerageConnectionById(id: string) {
  const { data } = await supabase
    .from('BrokerageIntegrationConnection')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as BrokerageIntegrationConnectionRow | null;
}

/** Find any active row for this (brokerage, user, toolkit). */
export async function findActiveBrokerageConnection(args: {
  brokerageId: string;
  userId: string;
  toolkit: string;
}): Promise<BrokerageIntegrationConnectionRow | null> {
  const { data } = await supabase
    .from('BrokerageIntegrationConnection')
    .select('*')
    .eq('brokerageId', args.brokerageId)
    .eq('userId', args.userId)
    .eq('toolkit', args.toolkit)
    .eq('status', 'active')
    .maybeSingle();
  return (data ?? null) as BrokerageIntegrationConnectionRow | null;
}

/**
 * Insert a new connection row. Caller is responsible for revoking any prior
 * active row for the same (brokerage, user, toolkit) BEFORE calling this —
 * the unique-active index will reject otherwise.
 */
export async function insertBrokerageConnection(args: {
  brokerageId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  label?: string;
}): Promise<BrokerageIntegrationConnectionRow | null> {
  const { data, error } = await supabase
    .from('BrokerageIntegrationConnection')
    .insert({
      brokerageId: args.brokerageId,
      userId: args.userId,
      toolkit: args.toolkit,
      composioConnectionId: args.composioConnectionId,
      label: args.label ?? null,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) {
    logger.error('[integrations.brokerage-connections] insert failed', {
      brokerageId: args.brokerageId,
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
  return data as BrokerageIntegrationConnectionRow;
}

/**
 * Upsert by `composioConnectionId`. Used by the OAuth callback: the connect
 * route persists the row at initiate-time, so the callback updates the label
 * (Composio surfaces the connected user's email after OAuth completes) and
 * bumps status back to 'active' if it drifted. Falls back to insert if the
 * row somehow doesn't exist.
 */
export async function upsertBrokerageByComposioId(args: {
  brokerageId: string;
  userId: string;
  toolkit: string;
  composioConnectionId: string;
  label?: string;
}): Promise<BrokerageIntegrationConnectionRow | null> {
  const existing = await findBrokerageByComposioId(args.composioConnectionId);
  if (existing) {
    const { error } = await supabase
      .from('BrokerageIntegrationConnection')
      .update({
        label: args.label ?? existing.label ?? null,
        status: 'active',
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      logger.error('[integrations.brokerage-connections] upsertByComposioId update failed', {
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
  return insertBrokerageConnection(args);
}

/** Flip a row's status. Used for reconnect (prior → revoked) and on errors. */
export async function setBrokerageConnectionStatus(args: {
  id: string;
  status: BrokerageIntegrationStatus;
  lastError?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('BrokerageIntegrationConnection')
    .update({
      status: args.status,
      lastError: args.lastError ?? null,
      updatedAt: new Date().toISOString(),
    })
    .eq('id', args.id);
  if (error) {
    logger.warn('[integrations.brokerage-connections] setStatus failed', {
      id: args.id,
      err: error.message,
    });
  }
}

/**
 * Revoke at Composio AND mark our row revoked. Idempotent. Brokerage-level
 * connections don't register curated triggers (no inbound-event wiring at the
 * brokerage level yet), so this is a straight delete-then-mark — no trigger
 * cleanup step like the realtor revoke path.
 */
export async function revokeBrokerageConnection(
  row: BrokerageIntegrationConnectionRow,
): Promise<void> {
  await composioDelete(row.composioConnectionId);
  await setBrokerageConnectionStatus({ id: row.id, status: 'revoked' });
}
