'use client';

/**
 * Smart sync view — the realtor's outside CRM, mirrored in here.
 *
 * One idea: connect your CRM once and its contacts live here.
 *
 * Three honest states:
 *   1. Not connected → calm connect prompt showing available CRMs.
 *   2. Connected + records → staggered list of contacts from the live CRM.
 *   3. Connected + empty → honest empty state (the CRM returned nothing).
 *
 * Live toolkits: hubspot, salesforce, pipedrive, zoho (all have Composio connectors).
 * Coming-soon toolkits: follow_up_boss, compass, boomtown, kvcore, real_geeks
 *   (no Composio toolkit exists yet — rendered as disabled "Coming soon" pills).
 *
 * Data contract: GET /api/sync?slug=<slug>
 *   { connected: boolean, source: string | null, records: SyncRecord[] }
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Plug, RefreshCw, Unplug, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  CAPTION,
  META,
  SECTION_LABEL,
} from '@/lib/typography';
import type { SyncRecord, SyncResponse } from '@/app/api/sync/route';

/* ── CRM catalog for the connect panel ─────────────────────────────── */

interface CrmEntry {
  toolkit: string;
  name: string;
  blurb: string;
  comingSoon?: boolean;
  /** Native (non-Composio) connect — opens the API-key dialog instead of OAuth. */
  native?: boolean;
}

/** CRM + real-estate entries surfaced on this page, in display order.
 *  Follow Up Boss leads the real-estate group (native API-key connect).
 *  General CRMs follow (Composio OAuth). Coming-soon entries render as
 *  disabled pills — no fake connect path. */
const CRM_ENTRIES: CrmEntry[] = [
  // Real-estate CRMs — Follow Up Boss connects natively via API key
  { toolkit: 'follow_up_boss', name: 'Follow Up Boss', blurb: 'Paste your API key — Chippi mirrors your people.', native: true },
  { toolkit: 'compass', name: 'Compass', blurb: 'Mirror your Compass pipeline.', comingSoon: true },
  { toolkit: 'boomtown', name: 'BoomTown', blurb: 'Pull BoomTown leads here.', comingSoon: true },
  { toolkit: 'kvcore', name: 'kvCORE', blurb: 'Pull kvCORE leads and tasks.', comingSoon: true },
  { toolkit: 'real_geeks', name: 'Real Geeks', blurb: 'Pull Real Geeks leads.', comingSoon: true },
  // General CRMs — live Composio connectors
  { toolkit: 'hubspot', name: 'HubSpot', blurb: 'Sync deals and contacts from HubSpot.' },
  { toolkit: 'salesforce', name: 'Salesforce', blurb: 'Mirror your Salesforce contacts.' },
  { toolkit: 'pipedrive', name: 'Pipedrive', blurb: 'Bring your Pipedrive contacts here.' },
  { toolkit: 'zoho', name: 'Zoho CRM', blurb: 'Two-way sync with Zoho.' },
];

const SOURCE_LABEL: Record<string, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  pipedrive: 'Pipedrive',
  zoho: 'Zoho CRM',
  follow_up_boss: 'Follow Up Boss',
};

function sourceLabel(source: string | null): string {
  if (!source) return 'your CRM';
  return SOURCE_LABEL[source] ?? source;
}

/* ── Props ──────────────────────────────────────────────────────────── */

interface SyncViewProps {
  slug: string;
}

/* ── Component ──────────────────────────────────────────────────────── */

export function SyncView({ slug }: SyncViewProps) {
  const [data, setData] = useState<SyncResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reduced = useReducedMotion();

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/sync?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(`Fetch failed (${res.status}).`);
      const json = (await res.json()) as SyncResponse;
      setData(json);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not reach your CRM.',
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords, refreshKey]);

  // Status sentence under the h1 — honest about what's connected.
  function statusSentence(): string {
    if (loading) return 'Checking your CRM connections.';
    if (errorMessage) return 'Could not load your contacts. Try again.';
    if (!data) return 'Connect a CRM to see your contacts here.';
    if (!data.connected) return 'Connect a CRM to bring your contacts in.';
    if (data.records.length === 0) return `Connected to ${sourceLabel(data.source)}. Nothing to show yet.`;
    return `${data.records.length} contact${data.records.length === 1 ? '' : 's'} from ${sourceLabel(data.source)}.`;
  }

  return (
    <div className="w-full mx-auto max-w-5xl pb-12 pt-10 sm:pt-14 space-y-8">
      {/* ── Page header ── */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Smart sync.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Your CRM, mirrored here.
        </h1>
        <p className={BODY_MUTED}>{statusSentence()}</p>
      </header>

      {/* ── Loading state ── */}
      {loading && (
        <p className={BODY_MUTED}>One moment — pulling your contacts.</p>
      )}

      {/* ── Error state ── */}
      {!loading && errorMessage && (
        <Card>
          <CardContent className="p-5 space-y-2">
            <p className={BODY}>I couldn&apos;t reach your CRM just now.</p>
            <p className={BODY_MUTED}>{errorMessage}</p>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className={cn(
                'mt-1 inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium',
                'border border-border/70 text-muted-foreground hover:text-foreground transition-colors duration-150',
              )}
            >
              <RefreshCw size={11} strokeWidth={1.75} />
              Try again
            </button>
          </CardContent>
        </Card>
      )}

      {/* ── Not connected → calm connect prompt ── */}
      {!loading && !errorMessage && data && !data.connected && (
        <ConnectPanel slug={slug} onConnected={() => setRefreshKey((k) => k + 1)} />
      )}

      {/* ── Connected + records ── */}
      {!loading && !errorMessage && data && data.connected && data.records.length > 0 && (
        <RecordsList
          records={data.records}
          source={data.source}
          slug={slug}
          reduced={!!reduced}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* ── Connected + empty ── */}
      {!loading && !errorMessage && data && data.connected && data.records.length === 0 && (
        <ConnectedEmptyState source={data.source} slug={slug} onRefresh={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}

/* ── Connect panel (not connected) ──────────────────────────────────── */

function ConnectPanel({ slug, onConnected }: { slug: string; onConnected: () => void }) {
  const [busyToolkit, setBusyToolkit] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [fubOpen, setFubOpen] = useState(false);

  async function handleOAuthConnect(toolkit: string) {
    setBusyToolkit(toolkit);
    setConnectError(null);
    try {
      const res = await fetch(`/api/integrations/connect/${toolkit}`, { method: 'POST' });
      const json = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !json.redirectUrl) {
        setConnectError(json.error ?? `Could not start ${toolkit} connect.`);
        setBusyToolkit(null);
        return;
      }
      window.location.assign(json.redirectUrl);
    } catch {
      setConnectError('Could not reach the integrations service.');
      setBusyToolkit(null);
    }
  }

  // Real-estate CRMs (native FUB + coming-soon) lead; general OAuth CRMs follow.
  const realEstate = CRM_ENTRIES.filter((e) => e.native || e.comingSoon);
  const live = CRM_ENTRIES.filter((e) => !e.native && !e.comingSoon);

  return (
    <div className="space-y-8">
      {connectError && (
        <p className="text-sm text-destructive">{connectError}</p>
      )}

      {/* Real-estate CRMs — Follow Up Boss connects natively, the rest soon */}
      <section className="space-y-3">
        <p className={SECTION_LABEL}>Real estate CRMs</p>
        <ul className="divide-y divide-border/60">
          {realEstate.map((entry) => (
            <CrmConnectRow
              key={entry.toolkit}
              entry={entry}
              busy={busyToolkit === entry.toolkit}
              onConnect={() =>
                entry.native ? setFubOpen(true) : handleOAuthConnect(entry.toolkit)
              }
            />
          ))}
        </ul>
      </section>

      {/* General CRMs — live */}
      <section className="space-y-3">
        <p className={SECTION_LABEL}>General CRMs</p>
        <ul className="divide-y divide-border/60">
          {live.map((entry) => (
            <CrmConnectRow
              key={entry.toolkit}
              entry={entry}
              busy={busyToolkit === entry.toolkit}
              onConnect={() => handleOAuthConnect(entry.toolkit)}
            />
          ))}
        </ul>
      </section>

      <p className={CAPTION}>
        Connect more apps in{' '}
        <a
          href={`/s/${slug}/settings?tab=connections`}
          className="text-foreground/70 hover:text-foreground underline-offset-2 hover:underline transition-colors"
        >
          Integrations settings
        </a>
        .
      </p>

      <FubConnectDialog
        slug={slug}
        open={fubOpen}
        onOpenChange={setFubOpen}
        onConnected={() => {
          setFubOpen(false);
          onConnected();
        }}
      />
    </div>
  );
}

/* ── Follow Up Boss — native API-key connect dialog ──────────────────── */

function FubConnectDialog({
  slug,
  open,
  onOpenChange,
  onConnected,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const key = apiKey.trim();
    if (!key) {
      setError('Enter your Follow Up Boss API key.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/follow-up-boss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, apiKey: key }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not connect Follow Up Boss.');
        setBusy(false);
        return;
      }
      setApiKey('');
      setBusy(false);
      onConnected();
    } catch {
      setError('Could not reach Follow Up Boss. Try again.');
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={TITLE_FONT}>Connect Follow Up Boss.</DialogTitle>
          <DialogDescription className={BODY_MUTED}>
            Paste your API key and Chippi mirrors your people here. Find it in
            Follow Up Boss → Admin → API.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 pt-1">
          <Label htmlFor="fub-api-key" className={SECTION_LABEL}>
            API key
          </Label>
          <Input
            id="fub-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="fka_live_…"
            disabled={busy}
            className="rounded-full"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className={cn(
              'inline-flex items-center h-9 px-4 rounded-full text-sm font-medium',
              'border border-border/70 text-muted-foreground hover:text-foreground transition-colors duration-150 disabled:opacity-50',
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium',
              'bg-foreground text-background hover:bg-foreground/90 transition-colors duration-150 disabled:opacity-50',
            )}
          >
            {busy ? <RefreshCw size={13} className="animate-spin" /> : <Plug size={13} />}
            {busy ? 'Connecting' : 'Connect'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CrmConnectRow({
  entry,
  busy,
  onConnect,
}: {
  entry: CrmEntry;
  busy: boolean;
  onConnect: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0">
      {/* Letter-circle icon fallback — no brand marks we don't have SVGs for */}
      <span
        aria-hidden
        className="w-8 h-8 rounded-md bg-muted text-muted-foreground inline-flex items-center justify-center text-sm font-semibold flex-shrink-0"
      >
        {entry.name[0]}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn(BODY, entry.comingSoon ? 'text-muted-foreground' : 'text-foreground')}>
          {entry.name}
        </p>
        <p className={CAPTION}>{entry.blurb}</p>
      </div>
      {entry.comingSoon ? (
        <span
          aria-disabled="true"
          className="inline-flex items-center h-7 px-3 rounded-full text-xs font-medium bg-muted text-muted-foreground flex-shrink-0"
        >
          Coming soon
        </span>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="inline-flex items-center h-7 px-3 rounded-full text-xs font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors flex-shrink-0 disabled:opacity-50"
        >
          {busy ? (
            <RefreshCw size={11} className="animate-spin" />
          ) : (
            <>
              <Plug size={11} className="mr-1.5" />
              Connect
            </>
          )}
        </button>
      )}
    </li>
  );
}

/* ── Shared connected-state toolbar ──────────────────────────────────── */

/**
 * Source label + refresh + a manage/disconnect action. Native sources
 * (Follow Up Boss) disconnect right here — there's no Composio connection
 * for Settings to manage. Composio sources link out to Settings instead.
 */
function SyncToolbar({
  source,
  slug,
  onRefresh,
}: {
  source: string | null;
  slug: string;
  onRefresh: () => void;
}) {
  const isNative = source === 'follow_up_boss';
  const [disconnecting, setDisconnecting] = useState(false);

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch('/api/integrations/follow-up-boss', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      onRefresh();
    } catch {
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className={SECTION_LABEL}>{sourceLabel(source)}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="h-7 w-7 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150"
          aria-label="Refresh contacts"
          title="Refresh contacts"
        >
          <RefreshCw size={13} strokeWidth={1.75} />
        </button>
        {isNative ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={disconnecting}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium',
              'border border-border/70 text-muted-foreground hover:text-foreground transition-colors duration-150 disabled:opacity-50',
            )}
          >
            <Unplug size={11} strokeWidth={1.75} />
            {disconnecting ? 'Disconnecting' : 'Disconnect'}
          </button>
        ) : (
          <a
            href={`/s/${slug}/settings?tab=connections`}
            className={cn(
              'inline-flex items-center gap-1 h-7 px-3 rounded-full text-xs font-medium',
              'border border-border/70 text-muted-foreground hover:text-foreground transition-colors duration-150',
            )}
          >
            Manage
            <ArrowUpRight size={11} strokeWidth={1.75} />
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Records list (connected + records) ─────────────────────────────── */

function RecordsList({
  records,
  source,
  slug,
  reduced,
  onRefresh,
}: {
  records: SyncRecord[];
  source: string | null;
  slug: string;
  reduced: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <SyncToolbar source={source} slug={slug} onRefresh={onRefresh} />

      {/* Staggered record list */}
      <motion.ul
        className="divide-y divide-border/60"
        variants={reduced ? undefined : STAGGER_CONTAINER}
        initial="initial"
        animate="enter"
      >
        {records.map((record) => (
          <RecordRow key={record.id} record={record} reduced={reduced} />
        ))}
      </motion.ul>
    </div>
  );
}

function RecordRow({ record, reduced }: { record: SyncRecord; reduced: boolean }) {
  const initials = record.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

  function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return null;
    }
  }

  const dateLabel = formatDate(record.lastActivityAt);

  return (
    <motion.li
      className="flex items-center gap-3 py-3 hover:bg-foreground/[0.04] -mx-3 px-3 rounded-sm transition-colors duration-150"
      variants={reduced ? undefined : STAGGER_ITEM}
    >
      {/* Avatar */}
      <span
        aria-hidden
        className="w-8 h-8 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold flex-shrink-0"
      >
        {initials || <User size={13} />}
      </span>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className={cn(BODY, 'font-medium truncate')}>{record.name}</p>
        <p className={cn(CAPTION, 'truncate')}>
          {record.email
            ? record.email
            : record.phone
              ? record.phone
              : <span className="opacity-50">no contact details</span>}
          {record.stage && (
            <span className="ml-2 inline-flex items-center text-[10px] font-medium uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-muted text-muted-foreground">
              {record.stage}
            </span>
          )}
        </p>
      </div>

      {/* Meta */}
      {dateLabel && (
        <span className={cn(META, 'shrink-0 tabular-nums')}>{dateLabel}</span>
      )}
    </motion.li>
  );
}

/* ── Connected + empty state ─────────────────────────────────────────── */

function ConnectedEmptyState({
  source,
  slug,
  onRefresh,
}: {
  source: string | null;
  slug: string;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <SyncToolbar source={source} slug={slug} onRefresh={onRefresh} />

      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
        <p className={BODY}>Nothing in your {sourceLabel(source)} yet.</p>
        <p className={cn(CAPTION, 'mt-1')}>
          Contacts and leads will appear here once they&apos;re in your CRM.
        </p>
      </div>
    </div>
  );
}
