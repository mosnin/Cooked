'use client';

import { useState } from 'react';
import { toastError } from '@/lib/toast-helpers';

interface RevokeInviteButtonProps {
  invitationId: string;
}

/**
 * Quiet text link, two-step confirm. Lives in the hover-revealed row action
 * group on the invitations list — same vocabulary as the Members page's
 * Remove / Offboard quiet links.
 */
export function RevokeInviteButton({ invitationId }: RevokeInviteButtonProps) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleRevoke() {
    setLoading(true);
    try {
      const res = await fetch(`/api/broker/invitations/${invitationId}`, {
        method: 'PATCH',
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        toastError(data.error ?? 'Failed to cancel invitation.');
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
          onClick={handleRevoke}
          disabled={loading}
          className="h-7 px-2 inline-flex items-center rounded-md text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 transition-colors disabled:opacity-50"
        >
          {loading ? 'Revoking…' : 'Confirm'}
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
      aria-label="Revoke invitation"
      className="h-7 px-2 inline-flex items-center rounded-md text-xs font-medium text-muted-foreground hover:text-rose-700 dark:hover:text-rose-400 hover:bg-muted transition-colors"
    >
      Revoke
    </button>
  );
}
