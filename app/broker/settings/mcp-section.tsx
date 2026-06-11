'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Copy, Check, Trash2, Plus, Key } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toastError } from '@/lib/toast-helpers';
import {
  H3,
  SECTION_LABEL,
  BODY_MUTED,
  CAPTION,
  PRIMARY_PILL,
} from '@/lib/typography';

type McpKey = {
  id: string;
  name: string;
  keyPrefix: string;
  clientId?: string;
  lastUsedAt: string | null;
  createdAt: string;
};

interface BrokerageMcpSectionProps {
  slug: string;
}

function CredentialRow({
  label,
  value,
  show,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  show: boolean;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className={SECTION_LABEL}>{label}</p>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-9 rounded-md border border-border/70 bg-background px-3 flex items-center overflow-hidden">
          <span className="text-sm font-mono select-all truncate">
            {show ? value : '•'.repeat(Math.min(value.length, 40))}
          </span>
        </div>
        <button
          type="button"
          className="h-9 px-3 rounded-md border border-border/70 text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors duration-150 inline-flex items-center gap-1.5"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            onCopy();
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * BrokerageMcpSection — MCP endpoint + API keys for brokerage-scoped access.
 * Same vocabulary as the realtor McpSection: hairline inputs, divide-y key
 * list, PRIMARY_PILL submit. The endpoint is shared; keys are scoped to the
 * brokerage owner's space.
 */
export function BrokerageMcpSection({ slug }: BrokerageMcpSectionProps) {
  const MCP_ENDPOINT = 'https://my.usechippi.com/api/mcp';

  const [keys, setKeys] = useState<McpKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCreds, setNewCreds] = useState<{
    key: string;
    clientId: string;
    clientSecret: string;
  } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);

  useEffect(() => {
    fetch(`/api/mcp-keys?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => setKeys([]))
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/mcp-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: newKeyName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewCreds({
          key: data.key,
          clientId: data.clientId,
          clientSecret: data.clientSecret,
        });
        setKeys((prev) => [
          {
            id: data.id,
            name: data.name,
            keyPrefix: data.keyPrefix,
            clientId: data.clientId,
            lastUsedAt: null,
            createdAt: data.createdAt,
          },
          ...prev,
        ]);
        setNewKeyName('');
      } else {
        toastError(data.error ?? "Couldn't create that key. Try again.");
      }
    } catch {
      toastError('I lost the connection. Try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this key? Anything using it stops working right away.')) return;
    setDeletingId(id);
    try {
      const res = await fetch('/api/mcp-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, id }),
      });
      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        toastError(data.error ?? "Couldn't delete that key. Try again.");
      }
    } catch {
      toastError('I lost the connection. Try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-10">
      {/* MCP — endpoint */}
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label className="text-[12.5px] font-medium text-foreground">Endpoint</Label>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-9 rounded-md border border-border/70 bg-background px-3 flex items-center">
              <span className="text-sm font-mono select-all">{MCP_ENDPOINT}</span>
            </div>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(MCP_ENDPOINT);
                setCopiedEndpoint(true);
                setTimeout(() => setCopiedEndpoint(false), 2000);
              }}
              className="h-9 px-3 rounded-md border border-border/70 text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors duration-150 inline-flex items-center gap-1.5"
            >
              {copiedEndpoint ? <Check size={12} /> : <Copy size={12} />}
              {copiedEndpoint ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className={CAPTION}>Streamable HTTP transport. Scoped to your brokerage.</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12.5px] font-medium text-foreground">How to connect</Label>
          <p className={BODY_MUTED}>
            Add this to your MCP config file (Claude Desktop, Cursor, Windsurf):
          </p>
          <div className="rounded-md border border-border/70 bg-foreground/[0.02] px-3 py-2.5 font-mono text-xs whitespace-pre overflow-x-auto">
{`{
  "mcpServers": {
    "chippi-brokerage": {
      "url": "${MCP_ENDPOINT}",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
          </div>
          <p className={CAPTION}>
            Generate an API key below and replace{' '}
            <span className="font-mono">YOUR_API_KEY</span>. This key gives access to
            every lead and deal in the brokerage.
          </p>
        </div>
      </div>

      {/* API Keys */}
      <div
        id="api-keys"
        className="space-y-5 pt-6 border-t border-border/60 scroll-mt-24"
      >
        <div className="flex items-center justify-between gap-3">
          <p className={SECTION_LABEL}>API keys</p>
          {!showForm && !newCreds && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors duration-150"
            >
              <Plus size={12} />
              New key
            </button>
          )}
        </div>

        {newCreds && (
          <div className="rounded-md border border-border/70 bg-foreground/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className={H3}>Your brokerage MCP credentials</p>
              <button
                type="button"
                onClick={() => setShowSecrets(!showSecrets)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                {showSecrets ? 'Hide' : 'Show'}
              </button>
            </div>
            <CredentialRow
              label="Server URL"
              value={MCP_ENDPOINT}
              show={true}
              onCopy={() => {
                setCopiedField('url');
                setTimeout(() => setCopiedField(null), 2000);
              }}
              copied={copiedField === 'url'}
            />
            <CredentialRow
              label="OAuth client ID"
              value={newCreds.clientId}
              show={showSecrets}
              onCopy={() => {
                setCopiedField('clientId');
                setTimeout(() => setCopiedField(null), 2000);
              }}
              copied={copiedField === 'clientId'}
            />
            <CredentialRow
              label="OAuth client secret"
              value={newCreds.clientSecret}
              show={showSecrets}
              onCopy={() => {
                setCopiedField('secret');
                setTimeout(() => setCopiedField(null), 2000);
              }}
              copied={copiedField === 'secret'}
            />
            <CredentialRow
              label="API key (alternative)"
              value={newCreds.key}
              show={showSecrets}
              onCopy={() => {
                setCopiedField('key');
                setTimeout(() => setCopiedField(null), 2000);
              }}
              copied={copiedField === 'key'}
            />
            <p className={CAPTION}>
              These credentials won&apos;t be shown again. Copy them now.
            </p>
            <button
              type="button"
              onClick={() => {
                setNewCreds(null);
                setShowForm(false);
                setShowSecrets(false);
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              Dismiss
            </button>
          </div>
        )}

        {showForm && !newCreds && (
          <div className="space-y-2">
            <Label
              htmlFor="brokerage-mcp-key-name"
              className="text-[12.5px] font-medium text-foreground"
            >
              Key name
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="brokerage-mcp-key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder='e.g. "Claude Desktop — Brokerage"'
                className="flex-1"
              />
              <button
                type="button"
                disabled={creating || !newKeyName.trim()}
                onClick={handleCreate}
                className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
              >
                {creating && <Loader2 size={13} className="animate-spin" />}
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setNewKeyName('');
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 px-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="h-16 rounded-md bg-foreground/[0.04] animate-pulse" />
        ) : keys.length === 0 ? (
          <p className={`${BODY_MUTED} italic`}>
            No keys yet. Generate one to connect a client.
          </p>
        ) : (
          <div>
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between gap-3 py-3 border-b border-border/60 last:border-b-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Key size={14} className="text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{k.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{k.keyPrefix}...</span>
                      <span>&#183;</span>
                      <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      {k.lastUsedAt && (
                        <>
                          <span>&#183;</span>
                          <span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(k.id)}
                  disabled={deletingId === k.id}
                  title="Delete key"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-foreground/[0.04] transition-colors duration-150 disabled:opacity-60"
                >
                  {deletingId === k.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
