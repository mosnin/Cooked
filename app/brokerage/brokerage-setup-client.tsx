'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Hash,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Users,
  BarChart3,
  Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';
import { cn } from '@/lib/utils';
import {
  H1,
  H2,
  H3,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  CAPTION,
} from '@/lib/typography';

interface BrokerageSetupClientProps {
  spaceSlug: string;
  existingBrokerageName: string | null;
  existingBrokerageId: string | null;
}

function CreateForm() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/broker/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/broker';
      } else {
        setError(data.error ?? 'Failed to create brokerage.');
      }
    } catch {
      setError("Couldn't reach the server — usually temporary.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="space-y-4">
      <div>
        <label className={cn(SECTION_LABEL, 'block mb-1.5')}>Brokerage name</label>
        <input
          type="text"
          required
          placeholder="e.g. Preston Realty Group"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full h-10 rounded-lg border border-border/70 bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
        {loading ? 'Creating…' : 'Create brokerage'}
        {!loading && <ArrowRight size={15} className="ml-2" />}
      </Button>
    </form>
  );
}

function JoinForm() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/broker/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        setJoined(data.brokerageName);
        setTimeout(() => (window.location.href = '/setup'), 1500);
      } else {
        setError(data.error ?? 'Failed to join brokerage.');
      }
    } catch {
      setError("Couldn't reach the server — usually temporary.");
    } finally {
      setLoading(false);
    }
  }

  if (joined) {
    return (
      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 py-2">
        <CheckCircle2 size={16} />
        <p className="text-sm font-medium">Joined {joined}. Redirecting…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleJoin} className="space-y-4">
      <div>
        <label className={cn(SECTION_LABEL, 'block mb-1.5')}>Invite code</label>
        <input
          type="text"
          required
          placeholder="ABCD-EF23"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={9}
          className="w-full h-10 rounded-lg border border-border/70 bg-background px-3 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className={cn(CAPTION, 'mt-1.5')}>
          Ask your broker for the 8-character code from their dashboard.
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
        {loading ? 'Joining…' : 'Join brokerage'}
        {!loading && <ArrowRight size={15} className="ml-2" />}
      </Button>
    </form>
  );
}

/** Neutral, paper-flat icon square — no brand tint. */
function IconSquare({
  icon: Icon,
  size = 'md',
}: {
  icon: typeof Building2;
  size?: 'md' | 'lg';
}) {
  return (
    <div
      className={cn(
        'rounded-lg bg-foreground/[0.06] text-foreground/70 flex items-center justify-center flex-shrink-0',
        size === 'lg' ? 'w-12 h-12' : 'w-10 h-10',
      )}
    >
      <Icon size={size === 'lg' ? 22 : 18} strokeWidth={1.75} />
    </div>
  );
}

export function BrokerageSetupClient({
  spaceSlug,
  existingBrokerageName,
}: BrokerageSetupClientProps) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');

  // Already part of a brokerage
  if (existingBrokerageName) {
    return (
      <div className="app-theme min-h-screen bg-background flex flex-col">
        <header className="px-6 py-5 border-b border-border/70">
          <Link href="/" aria-label="Chippi home">
            <BrandLogo className="h-6 w-auto" alt="Chippi" />
          </Link>
        </header>

        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="w-full max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <IconSquare icon={Building2} size="lg" />
            </div>
            <h1 className={cn(H1)} style={TITLE_FONT}>
              You&apos;re already set up
            </h1>
            <p className={cn(BODY_MUTED, 'mt-3')}>
              You&apos;re a member of{' '}
              <span className="font-medium text-foreground">{existingBrokerageName}</span>.
            </p>

            <div className="mt-8 flex flex-col gap-3">
              <Link href={`/s/${spaceSlug}`}>
                <Button className="w-full gap-2">
                  <ArrowLeft size={15} />
                  Back to my workspace
                </Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-theme min-h-screen bg-background flex flex-col">
      <header className="px-6 py-5 border-b border-border/70 flex items-center justify-between">
        <Link href="/" aria-label="Chippi home">
          <BrandLogo className="h-6 w-auto" alt="Chippi" />
        </Link>
        <Link
          href={`/s/${spaceSlug}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Back to workspace
        </Link>
      </header>

      <main className="flex-1 flex items-start justify-center px-6 py-16">
        <div className="w-full max-w-4xl">
          {/* Page header — quiet eyebrow, serif Times h1, one-line sub. */}
          <header className="mb-10 space-y-1.5">
            <p className={cn(SECTION_LABEL)}>Brokerage</p>
            <h1 className={cn(H1)} style={TITLE_FONT}>
              Set up your brokerage
            </h1>
            <p className={cn(BODY_MUTED, 'max-w-xl')}>
              Create your own brokerage to manage a team of realtors, or join one
              with a code from your broker.
            </p>
          </header>

          {mode === 'choose' && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Create card */}
              <button
                onClick={() => setMode('create')}
                className="group text-left rounded-xl border border-border/70 bg-card p-6 hover:border-border hover:bg-muted/30 transition-colors duration-150"
              >
                <IconSquare icon={Building2} />
                <h2 className={cn(H3, 'mt-5 mb-2')}>Create a brokerage</h2>
                <p className={cn(BODY_MUTED, 'leading-relaxed mb-5')}>
                  Start your own brokerage. Invite realtors to join, manage their
                  leads, and get team-wide visibility from a central broker
                  dashboard.
                </p>
                <div className="space-y-2 mb-6">
                  {[
                    { icon: Users, label: 'Invite realtors via email or share code' },
                    { icon: BarChart3, label: 'Team-wide lead and pipeline analytics' },
                    { icon: Mail, label: 'Manage brokerage invitations' },
                  ].map((f) => (
                    <div key={f.label} className={cn(BODY_MUTED, 'flex items-center gap-2')}>
                      <f.icon
                        size={13}
                        strokeWidth={1.75}
                        className="text-muted-foreground/70 flex-shrink-0"
                      />
                      {f.label}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground transition-all duration-150 group-hover:gap-2.5">
                  Create a brokerage <ArrowRight size={14} strokeWidth={2} />
                </div>
              </button>

              {/* Join card */}
              <button
                onClick={() => setMode('join')}
                className="group text-left rounded-xl border border-border/70 bg-card p-6 hover:border-border hover:bg-muted/30 transition-colors duration-150"
              >
                <IconSquare icon={Hash} />
                <h2 className={cn(H3, 'mt-5 mb-2')}>Join a brokerage</h2>
                <p className={cn(BODY_MUTED, 'leading-relaxed mb-5')}>
                  Enter the invite code your broker shared with you. You&apos;ll keep
                  your own workspace, leads, and pipeline — this just connects you
                  to the brokerage network.
                </p>
                <div className="space-y-2 mb-6">
                  {[
                    { icon: CheckCircle2, label: 'Your workspace and data stay separate' },
                    { icon: CheckCircle2, label: 'Your broker gets team-level visibility' },
                    { icon: CheckCircle2, label: 'Works instantly with an 8-character code' },
                  ].map((f) => (
                    <div key={f.label} className={cn(BODY_MUTED, 'flex items-center gap-2')}>
                      <f.icon
                        size={13}
                        strokeWidth={1.75}
                        className="text-muted-foreground/70 flex-shrink-0"
                      />
                      {f.label}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground transition-all duration-150 group-hover:gap-2.5">
                  Join with a code <ArrowRight size={14} strokeWidth={2} />
                </div>
              </button>
            </div>
          )}

          {mode === 'create' && (
            <div className="max-w-md">
              <button
                onClick={() => setMode('choose')}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
              >
                <ArrowLeft size={14} /> Back
              </button>
              <div className="rounded-xl border border-border/70 bg-card p-6">
                <IconSquare icon={Building2} />
                <h2 className={cn(H2, 'mt-5 mb-1')}>Create a brokerage</h2>
                <p className={cn(BODY_MUTED, 'mb-6')}>
                  Give your brokerage a name. You can invite realtors after it&apos;s
                  created.
                </p>
                <CreateForm />
              </div>
            </div>
          )}

          {mode === 'join' && (
            <div className="max-w-md">
              <button
                onClick={() => setMode('choose')}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
              >
                <ArrowLeft size={14} /> Back
              </button>
              <div className="rounded-xl border border-border/70 bg-card p-6">
                <IconSquare icon={Hash} />
                <h2 className={cn(H2, 'mt-5 mb-1')}>Join a brokerage</h2>
                <p className={cn(BODY_MUTED, 'mb-6')}>
                  Enter the code from your broker&apos;s dashboard. It looks like{' '}
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    ABCD-EF23
                  </code>
                  .
                </p>
                <JoinForm />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
