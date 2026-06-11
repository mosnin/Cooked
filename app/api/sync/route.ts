/**
 * GET /api/sync?slug=<slug>
 *
 * Detects the realtor's connected CRM(s) and pulls records via Composio.
 *
 * Unified contract:
 *   { connected: boolean, source: string | null, records: SyncRecord[] }
 *
 * Live toolkits (general CRM — hubspot, salesforce, pipedrive, zoho):
 *   Pulls contacts/leads via Composio tools and maps them to the unified
 *   SyncRecord shape.
 *
 * Coming-soon toolkits (follow_up_boss, compass, boomtown, kvcore, real_geeks):
 *   No Composio toolkit exists yet. These never produce records here — the
 *   page renders them as "Coming soon" affordances, not live data.
 *
 * Auth: requireSpaceOwner(slug) — caller must own the workspace.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { findActive } from '@/lib/integrations/connections';
import { executeToolForEntity } from '@/lib/integrations/composio';
import { decrypt } from '@/lib/crypto';
import { listPeople as fubListPeople } from '@/lib/integrations/follow-up-boss';
import { logger } from '@/lib/logger';
import { withObservability } from '@/lib/with-observability';

/** The CRM toolkits that have live Composio connectors. */
const LIVE_CRM_TOOLKITS = ['hubspot', 'salesforce', 'pipedrive', 'zoho'] as const;
type LiveCrmToolkit = (typeof LIVE_CRM_TOOLKITS)[number];

/** Unified record shape exposed to the sync view. */
export interface SyncRecord {
  id: string;
  name: string;
  /** Email address if available. */
  email: string | null;
  /** Phone number if available. */
  phone: string | null;
  /** Pipeline stage / deal status if available. */
  stage: string | null;
  /** ISO timestamp of last activity. */
  lastActivityAt: string | null;
  /** Raw toolkit-specific type label ("Contact", "Lead", "Deal", etc.) */
  recordType: string;
}

export interface SyncResponse {
  connected: boolean;
  /** Toolkit slug of the connected CRM, or null if none. */
  source: string | null;
  records: SyncRecord[];
}

/**
 * Tool slug lookup per toolkit — the Composio action we call to pull contacts.
 * These slugs come from the Composio catalog. We pull contacts first (most
 * universal CRM primitive) then fall back gracefully if the action fails.
 */
const TOOLKIT_CONTACT_ACTION: Record<LiveCrmToolkit, string> = {
  hubspot: 'HUBSPOT_LIST_CONTACTS',
  salesforce: 'SALESFORCE_LIST_CONTACTS',
  pipedrive: 'PIPEDRIVE_GET_ALL_PERSONS',
  zoho: 'ZOHOCRM_GET_CONTACTS',
};

/** Map raw Composio response items to the unified SyncRecord shape. */
function mapToRecords(toolkit: LiveCrmToolkit, raw: unknown[]): SyncRecord[] {
  return raw
    .filter(Boolean)
    .slice(0, 50) // cap at 50 records — this surface is a mirror, not a paginated table
    .map((item, idx) => {
      const obj = item as Record<string, unknown>;

      // HubSpot: { id, properties: { firstname, lastname, email, phone, hs_lead_status, lastmodifieddate } }
      if (toolkit === 'hubspot') {
        const props = (obj.properties ?? obj) as Record<string, unknown>;
        const fn = String(props.firstname ?? props.first_name ?? '').trim();
        const ln = String(props.lastname ?? props.last_name ?? '').trim();
        return {
          id: String(obj.id ?? idx),
          name: [fn, ln].filter(Boolean).join(' ') || String(props.email ?? props.name ?? '(no name)'),
          email: String(props.email ?? '') || null,
          phone: String(props.phone ?? '') || null,
          stage: String(props.hs_lead_status ?? props.lifecyclestage ?? '') || null,
          lastActivityAt: String(props.lastmodifieddate ?? props.createdate ?? '') || null,
          recordType: 'Contact',
        };
      }

      // Salesforce: { Id, FirstName, LastName, Email, Phone, LeadStatus, LastModifiedDate }
      if (toolkit === 'salesforce') {
        const fn = String(obj.FirstName ?? '').trim();
        const ln = String(obj.LastName ?? '').trim();
        return {
          id: String(obj.Id ?? idx),
          name: [fn, ln].filter(Boolean).join(' ') || String(obj.Name ?? obj.Email ?? '(no name)'),
          email: String(obj.Email ?? '') || null,
          phone: String(obj.Phone ?? obj.MobilePhone ?? '') || null,
          stage: String(obj.LeadStatus ?? obj.Status ?? '') || null,
          lastActivityAt: String(obj.LastModifiedDate ?? obj.CreatedDate ?? '') || null,
          recordType: String((obj.attributes as Record<string, unknown> | undefined)?.type ?? 'Contact'),
        };
      }

      // Pipedrive: { id, name, email[{value}], phone[{value}], last_activity_date }
      if (toolkit === 'pipedrive') {
        const emails = (obj.email as { value?: string }[] | undefined) ?? [];
        const phones = (obj.phone as { value?: string }[] | undefined) ?? [];
        return {
          id: String(obj.id ?? idx),
          name: String(obj.name ?? '(no name)'),
          email: emails[0]?.value ?? null,
          phone: phones[0]?.value ?? null,
          stage: null,
          lastActivityAt: String(obj.last_activity_date ?? obj.update_time ?? '') || null,
          recordType: 'Contact',
        };
      }

      // Zoho: { id, Full_Name, Email, Phone, Lead_Status, Modified_Time }
      if (toolkit === 'zoho') {
        return {
          id: String(obj.id ?? obj.Id ?? idx),
          name: String(obj.Full_Name ?? obj.Name ?? obj.full_name ?? '(no name)'),
          email: String(obj.Email ?? '') || null,
          phone: String(obj.Phone ?? obj.Mobile ?? '') || null,
          stage: String(obj.Lead_Status ?? obj.Account_Type ?? '') || null,
          lastActivityAt: String(obj.Modified_Time ?? obj.Created_Time ?? '') || null,
          recordType: 'Contact',
        };
      }

      // Generic fallback
      return {
        id: String(obj.id ?? idx),
        name: String(obj.name ?? obj.Name ?? obj.email ?? '(no name)'),
        email: String(obj.email ?? obj.Email ?? '') || null,
        phone: String(obj.phone ?? obj.Phone ?? '') || null,
        stage: null,
        lastActivityAt: null,
        recordType: 'Contact',
      };
    });
}

async function GETHandler(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  // Native (non-Composio) CRMs take priority — Follow Up Boss reads straight
  // from its REST API with the encrypted key we stored on connect.
  const fub = await findActive({ spaceId: space.id, userId, toolkit: 'follow_up_boss' });
  if (fub?.secretCiphertext) {
    try {
      const { ok, records } = await fubListPeople(decrypt(fub.secretCiphertext), 50);
      return NextResponse.json<SyncResponse>({
        connected: true,
        source: 'follow_up_boss',
        records: ok ? records : [],
      });
    } catch (err) {
      logger.error('[sync] follow up boss read failed', {
        spaceId: space.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json<SyncResponse>({
        connected: true,
        source: 'follow_up_boss',
        records: [],
      });
    }
  }

  // Find the first active CRM connection (prefer hubspot > salesforce > pipedrive > zoho).
  let connectedToolkit: LiveCrmToolkit | null = null;
  for (const tk of LIVE_CRM_TOOLKITS) {
    const row = await findActive({ spaceId: space.id, userId, toolkit: tk });
    if (row) {
      connectedToolkit = tk;
      break;
    }
  }

  if (!connectedToolkit) {
    return NextResponse.json<SyncResponse>({
      connected: false,
      source: null,
      records: [],
    });
  }

  const actionSlug = TOOLKIT_CONTACT_ACTION[connectedToolkit];

  try {
    const result = await executeToolForEntity({
      entityId: userId,
      slug: actionSlug,
      arguments: { limit: 50 },
    });

    // Composio's ToolExecuteResponse shape:
    //   { successful: boolean, data: unknown, error?: string }
    const res = result as { successful?: boolean; data?: unknown; error?: string };

    if (!res.successful) {
      logger.warn('[sync] tool execute not successful', {
        toolkit: connectedToolkit,
        action: actionSlug,
        error: res.error,
      });
      // Return connected=true but empty records — the connection is live,
      // the fetch just returned nothing actionable. Honest.
      return NextResponse.json<SyncResponse>({
        connected: true,
        source: connectedToolkit,
        records: [],
      });
    }

    // Composio wraps the list in different shapes depending on the toolkit.
    // We peel back one layer to find the array.
    const data = res.data as Record<string, unknown> | unknown[] | null;
    let rawItems: unknown[] = [];

    if (Array.isArray(data)) {
      rawItems = data;
    } else if (data && typeof data === 'object') {
      // Most toolkits return { results: [...] } or { contacts: [...] } or
      // { data: [...] } or { records: [...] } or { items: [...] }
      const container =
        (data as Record<string, unknown>).results ??
        (data as Record<string, unknown>).contacts ??
        (data as Record<string, unknown>).data ??
        (data as Record<string, unknown>).records ??
        (data as Record<string, unknown>).items ??
        (data as Record<string, unknown>).persons ??
        [];
      rawItems = Array.isArray(container) ? container : [];
    }

    const records = mapToRecords(connectedToolkit, rawItems);

    return NextResponse.json<SyncResponse>({
      connected: true,
      source: connectedToolkit,
      records,
    });
  } catch (err) {
    logger.error('[sync] execute failed', {
      toolkit: connectedToolkit,
      action: actionSlug,
      err: err instanceof Error ? err.message : String(err),
    });
    // Don't leak internals — return a connected+empty shape so the page
    // renders the honest empty state rather than an error page.
    return NextResponse.json<SyncResponse>({
      connected: true,
      source: connectedToolkit,
      records: [],
    });
  }
}

export const GET = withObservability(GETHandler, 'api.sync');
