'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/formatting';

interface ActivityItem {
  id: string;
  type: 'lead' | 'deal' | 'tour';
  actor: string;
  action: string;
  entity: string;
  timestamp: string;
}

const DOT_COLORS: Record<ActivityItem['type'], string> = {
  lead: 'bg-emerald-500',
  deal: 'bg-blue-500',
  tour: 'bg-amber-500',
};

export function TeamActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/broker/team-activity', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setActivities(d.activities ?? []))
      .catch((err) => { if (err.name !== 'AbortError') setActivities([]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <ul className="divide-y divide-border/60">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-start gap-3 py-3">
            <div className="mt-1.5 h-2 w-2 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-3/4 bg-muted/30 animate-pulse rounded" />
              <div className="h-2.5 w-1/3 bg-muted/20 animate-pulse rounded" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-3">
        Quiet — no team activity yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {activities.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-3">
          <div
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_COLORS[item.type]}`}
          />
          <p className="text-sm leading-snug">
            <span className="font-medium">{item.actor}</span>{' '}
            <span className="text-muted-foreground">{item.action}</span>{' '}
            <span className="font-medium">{item.entity}</span>
            <span className="text-muted-foreground">
              {' '}&mdash; {timeAgo(item.timestamp)}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
