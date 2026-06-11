'use client';

import { useState } from 'react';
import { toastError } from '@/lib/toast-helpers';

interface RemoveMemberButtonProps {
  membershipId: string;
  memberName: string;
}

/**
 * Quiet text link that two-steps into a confirm. Lives in the hover-revealed
 * row action group — matches the realtor People page's inline action pattern.
 */
export function RemoveMemberButton({ membershipId, memberName }: RemoveMemberButtonProps) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleRemove() {
    setLoading(true);
    try {
      const res = await fetch(`/api/broker/members/${membershipId}`, { method: 'DELETE' });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        toastError(data.error ?? 'Failed to remove member.');
      }
    } catch {
      toastError("Couldn't reach the server — usually temporary.");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleRemove}
          disabled={loading}
          className="h-7 px-2 inline-flex items-center rounded-md text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 transition-colors disabled:opacity-50"
        >
          {loading ? 'Removing…' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="h-7 px-2 inline-flex items-center rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Remove ${memberName}`}
      className="h-7 px-2 inline-flex items-center rounded-md text-xs font-medium text-muted-foreground hover:text-rose-700 dark:hover:text-rose-400 hover:bg-muted transition-colors"
    >
      Remove
    </button>
  );
}
