/**
 * POST /api/internal/integrations/search — internal endpoint the Chippi
 * agent's `find_integration_tool` calls when it needs to discover what
 * Composio actions are available for the realtor's connected toolkits.
 * Authed by AGENT_INTERNAL_SECRET.
 *
 * Why a search endpoint instead of front-loading every tool: a realtor
 * with Gmail + HubSpot + Slack + Instagram connected can have 500+
 * actions across those toolkits. Front-loading them all blows xAI's
 * 200-tool ceiling and burns thousands of prompt tokens per turn even
 * on chats that never touch an integration. The dispatcher pattern
 * (find → execute) keeps the model's working set small and lets it
 * fetch the exact tool it needs only when it needs it.
 *
 * Two call shapes:
 *  1. { spaceId, userId, query, limit? }  — natural-language search
 *     (the runtime path; dispatcher's find_integration_tool uses this).
 *  2. { spaceId, userId, slugs: string[] } — exact-slug fetch, bypasses
 *     scoring and returns the schemas for the given slugs IFF the slug's
 *     toolkit is active for this (spaceId, userId). The agent loader uses
 *     this at build time to pre-fetch schemas for the curated top-N
 *     actions per connected toolkit (see agent/integrations_curated.py),
 *     so common calls skip the dispatcher's two-hop round trip.
 * Returns: { tools: [{slug, name, description, parameters, toolkit}] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getComposio, composioConfigured } from '@/lib/integrations/composio';
import { activeToolkits } from '@/lib/integrations/connections';
import { checkRateLimit } from '@/lib/rate-limit';
import { userOwnsSpace } from '@/lib/space';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RawComposioTool {
  slug: string;
  name?: string;
  description?: string;
  inputParameters?: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const PER_TOOLKIT_FETCH = 200;

export async function POST(req: NextRequest) {
  const secret = process.env.AGENT_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!composioConfigured()) {
    return NextResponse.json({ tools: [] });
  }

  let body: {
    spaceId?: unknown;
    userId?: unknown;
    query?: unknown;
    limit?: unknown;
    slugs?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const spaceId = typeof body.spaceId === 'string' ? body.spaceId : '';
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const limitRaw = typeof body.limit === 'number' ? body.limit : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)));
  // Exact-slug fetch path — bypass scoring entirely. Empty/missing array
  // falls through to the natural-language search path.
  const slugFilter = Array.isArray(body.slugs)
    ? (body.slugs
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .slice(0, 200))
    : [];
  if (!spaceId || !userId) {
    return NextResponse.json({ error: 'spaceId and userId are required' }, { status: 400 });
  }

  // The bearer secret authenticates Modal, not the (spaceId, userId) pair.
  // Verify ownership before the rate-limit so a mismatched spaceId can't drain
  // another workspace's search budget. activeToolkits below already scopes data
  // by (spaceId, userId); this closes the rate-limit-key gap ahead of it.
  if (!(await userOwnsSpace(spaceId, userId))) {
    return NextResponse.json({ error: 'space/user mismatch' }, { status: 403 });
  }

  // Per-space cap — a runaway agent that keeps calling find_integration_tool
  // could rack up real Composio API spend. 60/hour gives roughly one search
  // per chat minute, well above any legitimate use.
  const rl = await checkRateLimit(`integrations:search:${spaceId}`, 60, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many tool searches' }, { status: 429 });
  }

  let toolkits: string[];
  try {
    toolkits = await activeToolkits({ spaceId, userId });
  } catch (err) {
    logger.warn('[integrations.search] activeToolkits lookup failed', {
      spaceId,
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ tools: [] });
  }
  if (toolkits.length === 0) {
    return NextResponse.json({ tools: [] });
  }

  const composio = getComposio();

  // Fetch each toolkit's actions in parallel — by the time we're searching
  // the realtor has already triggered the chat turn, so latency here is
  // user-perceptible. Per-toolkit isolation means one dead connection
  // doesn't poison the batch.
  const perToolkit = await Promise.all(
    toolkits.map(async (toolkit) => {
      try {
        const raw = (await composio.tools.getRawComposioTools({
          toolkits: [toolkit],
          limit: PER_TOOLKIT_FETCH,
        })) as RawComposioTool[];
        return raw.map((t) => ({ tool: t, toolkit }));
      } catch (err) {
        logger.warn('[integrations.search] toolkit fetch failed — skipping', {
          spaceId,
          userId,
          toolkit,
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    }),
  );

  const all = perToolkit.flat().filter((x) => x.tool.slug);

  // Exact-slug fetch — agent build-time path for the curated allowlist.
  // Filter `all` by the requested slug set, return verbatim (no scoring,
  // no ranking), preserving the order the caller asked for so the agent's
  // tool list comes back in the curated-list order it expects.
  if (slugFilter.length > 0) {
    const wanted = new Set(slugFilter.map((s) => s.toUpperCase()));
    const bySlug = new Map<string, { tool: RawComposioTool; toolkit: string }>();
    for (const entry of all) {
      const key = entry.tool.slug.toUpperCase();
      if (wanted.has(key) && !bySlug.has(key)) bySlug.set(key, entry);
    }
    const ordered = slugFilter
      .map((s) => bySlug.get(s.toUpperCase()))
      .filter((x): x is { tool: RawComposioTool; toolkit: string } => Boolean(x))
      .map(({ tool, toolkit }) => ({
        slug: tool.slug,
        name: (tool.name || tool.slug).slice(0, 64),
        description: (tool.description || tool.slug).slice(0, 1024),
        parameters: tool.inputParameters || { type: 'object', properties: {} },
        toolkit,
      }));
    return NextResponse.json({ tools: ordered });
  }

  // Score each tool against the query — token-presence on slug / name /
  // description, weighted by where the hit landed. The prior version
  // layered a hand-curated verb-synonym map (read↔fetch↔list, etc.) on
  // top; the audit caught it for what it was — keyword expansion that
  // covered just enough cases to be load-bearing and just few enough to
  // break on every unmapped verb ("check", "reply"). Real semantic
  // search against Composio tool embeddings is the right fix; tracked
  // as Phase 4 follow-up. Until then, trust the model to retry
  // find_integration_tool with better keywords if the first pass
  // returns nothing useful — the dispatcher already cost a turn, one
  // more is cheap.
  const q = query.toLowerCase();
  const qTokens = q.split(/\s+/).filter(Boolean);
  const scored = all.map(({ tool, toolkit }) => {
    let score = 0;
    if (q) {
      const slug = tool.slug.toLowerCase();
      const name = (tool.name || '').toLowerCase();
      const desc = (tool.description || '').toLowerCase();
      const tk = toolkit.toLowerCase();
      // Whole-query substring is the strongest signal.
      if (slug.includes(q)) score += 200;
      if (name.includes(q)) score += 150;
      if (tk.includes(q)) score += 80;
      if (desc.includes(q)) score += 40;
      // Per-token — slug match dominates, then name, then description.
      for (const tok of qTokens) {
        if (slug.includes(tok)) score += 60;
        if (name.includes(tok)) score += 40;
        if (desc.includes(tok)) score += 20;
      }
    }
    return { tool, toolkit, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map(({ tool, toolkit }) => ({
    slug: tool.slug,
    name: (tool.name || tool.slug).slice(0, 64),
    description: (tool.description || tool.slug).slice(0, 1024),
    parameters: tool.inputParameters || { type: 'object', properties: {} },
    toolkit,
  }));

  return NextResponse.json({ tools: top });
}

