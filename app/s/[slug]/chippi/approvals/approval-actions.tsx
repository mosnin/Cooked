'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRIMARY_PILL, GHOST_PILL } from '@/lib/typography';

interface ApprovalActionsProps {
  taskId: string;
  slug: string;
}

export function ApprovalActions({ taskId, slug }: ApprovalActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);

  async function handle(action: 'approve' | 'reject') {
    if (pending) return;
    setPending(action);

    try {
      const res = await fetch('/api/agent/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? 'Something went wrong.';
        toast.error(msg);
        setPending(null);
        return;
      }

      if (action === 'approve') {
        toast.success('Approved. Chippi will continue.');
      } else {
        toast.success('Rejected. Action cancelled.');
      }

      // Refresh the server component so the resolved item disappears.
      router.refresh();
    } catch {
      toast.error('Network error. Try again.');
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-2 pl-0.5">
      <button
        onClick={() => handle('approve')}
        disabled={pending !== null}
        className={cn(PRIMARY_PILL, 'disabled:opacity-50')}
      >
        <Check size={13} />
        {pending === 'approve' ? 'Approving…' : 'Approve'}
      </button>

      <button
        onClick={() => handle('reject')}
        disabled={pending !== null}
        className={cn(GHOST_PILL, 'disabled:opacity-50')}
      >
        <X size={13} />
        {pending === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
    </div>
  );
}
