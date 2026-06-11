'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { toastError } from '@/lib/toast-helpers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ChangeRoleButtonProps {
  membershipId: string;
  currentRole: string;
  memberName: string;
}

const ROLES = [
  { value: 'broker_admin', label: 'Admin' },
  { value: 'realtor_member', label: 'Realtor' },
];

/**
 * Quiet text link that opens a small role-picker menu. Lives inside the
 * hover-revealed action row on Members rows — same vocabulary as the
 * realtor People page's inline edit/delete affordances.
 */
export function ChangeRoleButton({
  membershipId,
  currentRole,
  memberName,
}: ChangeRoleButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleChange(newRole: string) {
    if (newRole === currentRole) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/broker/members/${membershipId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        toastError(data.error ?? 'Failed to change role.');
      }
    } catch {
      toastError("Couldn't reach the server — usually temporary.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={loading}
          aria-label={`Change role for ${memberName}`}
          className="h-7 px-2 inline-flex items-center rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Change role'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {ROLES.map((r) => (
          <DropdownMenuItem
            key={r.value}
            onSelect={() => handleChange(r.value)}
            className={cn(
              'text-xs',
              r.value === currentRole && 'font-semibold text-foreground',
            )}
          >
            {r.label}
            {r.value === currentRole && (
              <span className="ml-auto text-[10px] text-muted-foreground">current</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
