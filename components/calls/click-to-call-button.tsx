'use client';

/**
 * ClickToCallButton — place a call to a contact from anywhere it's embedded.
 *
 * POSTs to /api/calls, which dials the realtor's own phone first and bridges to
 * the contact when they pick up. The button reflects the lifecycle locally:
 * idle → calling → connected, then settles back to idle. The actual call rings
 * the realtor's phone, so "Connected" here means the call was placed, not that
 * the contact answered.
 *
 * Reusable: pass slug + the contact's phone (and optionally contactId so the
 * call is logged against the contact). The parent decides where this lives.
 *
 * Design: Jobs lens — one verb ("Call"), outline by default so it doesn't
 * compete with a page's primary action; calm transitional copy; no spinner
 * theater. When calling isn't configured the API returns cleanly and we say so
 * once, quietly.
 */

import { useState } from 'react';
import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import { cn } from '@/lib/utils';

type CallState = 'idle' | 'calling' | 'connected';

interface ClickToCallButtonProps {
  slug: string;
  /** The contact's phone number to dial. */
  phone: string | null | undefined;
  /** Optional — logs the call against this contact. */
  contactId?: string | null;
  /** Button label when idle. */
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}

export function ClickToCallButton({
  slug,
  phone,
  contactId,
  label = 'Call',
  variant = 'outline',
  size = 'sm',
  className,
}: ClickToCallButtonProps) {
  const [state, setState] = useState<CallState>('idle');

  const disabled = !phone || state !== 'idle';

  const handleClick = async () => {
    if (!phone) {
      toastError('No phone number on file.');
      return;
    }
    setState('calling');
    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, contactId: contactId ?? null, toNumber: phone }),
      });
      const data = (await res.json()) as {
        call?: { status?: string };
        configured?: boolean;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        toastError(data.error ?? 'Could not place the call.');
        setState('idle');
        return;
      }

      if (data.configured === false) {
        toastError(data.message ?? 'Calling is not set up yet.');
        setState('idle');
        return;
      }

      setState('connected');
      toastSuccess('Calling — pick up your phone.');
      // Settle back so the button is reusable for the next call.
      setTimeout(() => setState('idle'), 4000);
    } catch {
      toastError('Could not place the call.');
      setState('idle');
    }
  };

  const text = state === 'calling' ? 'Calling…' : state === 'connected' ? 'Connected' : label;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={handleClick}
      className={cn('gap-2', className)}
    >
      <Phone size={14} strokeWidth={1.75} />
      {text}
    </Button>
  );
}
