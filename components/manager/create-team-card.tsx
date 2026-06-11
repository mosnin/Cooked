'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, ExternalLink } from 'lucide-react';

interface CreateTeamCardProps {
  /** If the user is already a manager, link to their dashboard instead. */
  existingTeamName?: string | null;
}

export function CreateTeamCard({ existingTeamName }: CreateTeamCardProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Already a manager — show link
  if (existingTeamName) {
    return (
      <Card>
        <CardContent className="px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-foreground/[0.06] flex items-center justify-center flex-shrink-0">
                <Building2 size={15} className="text-foreground/70" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{existingTeamName}</p>
                <p className="text-xs text-muted-foreground">Your team</p>
              </div>
            </div>
            <a href="/manager">
              <Button variant="outline" size="sm" className="flex items-center gap-1.5 flex-shrink-0">
                <ExternalLink size={13} />
                Manager dashboard
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await fetch('/api/manager/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/manager';
      } else {
        setError(data.error ?? 'Failed to create team.');
      }
    } catch {
      setError("Couldn't reach the server — usually temporary.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-foreground/[0.06] flex items-center justify-center flex-shrink-0">
            <Building2 size={15} className="text-foreground/70" />
          </div>
          <div>
            <p className="text-sm font-semibold">Create a team</p>
            <p className="text-xs text-muted-foreground">Invite reps and get team visibility</p>
          </div>
        </div>
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            required
            placeholder="Team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={loading || !name.trim()}>
            {loading ? 'Creating…' : 'Create'}
          </Button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
