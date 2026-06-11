'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, RefreshCw, Hash } from 'lucide-react';
import { toastError } from '@/lib/toast-helpers';

export function InviteCodeCard({ isOwner = true }: { isOwner?: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/broker/join-code')
      .then((r) => r.json())
      .then((d) => setCode(d.joinCode ?? null))
      .catch(() => setCode(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch('/api/broker/join-code', { method: 'POST' });
      const data = await res.json();
      if (res.ok) setCode(data.joinCode);
      else toastError(data.error ?? 'Failed to generate code.');
    } catch {
      toastError("Couldn't reach the server — usually temporary.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!code) return;
    const appUrl = window.location.origin;
    await navigator.clipboard.writeText(`${appUrl}/join/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardContent className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-foreground/[0.06] flex items-center justify-center flex-shrink-0">
            <Hash size={15} className="text-foreground/70" />
          </div>
          <div>
            <p className="text-sm font-semibold">Invite code</p>
            <p className="text-xs text-muted-foreground">Share this code — anyone can use it to join as a Realtor</p>
          </div>
        </div>

        {loading ? (
          <div className="h-9 rounded-md bg-muted animate-pulse" />
        ) : code ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-9 rounded-md border border-input bg-muted/40 px-3 flex items-center">
              <span className="text-sm font-mono font-semibold tracking-widest">{code}</span>
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleCopy}>
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              {copied ? 'Copied.' : 'Copy link'}
            </Button>
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-muted-foreground"
                onClick={handleGenerate}
                disabled={generating}
                title="Regenerate code (old code will stop working)"
              >
                <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
              </Button>
            )}
          </div>
        ) : isOwner ? (
          <Button size="sm" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate invite code'}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">No invite code set. Ask the brokerage owner to generate one.</p>
        )}

        {code && (
          <p className="text-xs text-muted-foreground">
            Link: <span className="font-mono">{typeof window !== 'undefined' ? window.location.origin : ''}/join/{code}</span>
            {' · '}Rotating generates a new code; the old one stops working immediately.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
