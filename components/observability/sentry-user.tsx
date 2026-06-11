'use client';

import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { setUserContext } from '@/lib/observability';

/**
 * Mounts once high in the tree and keeps the Sentry scope's user tag in sync
 * with the Clerk session.  Only the user id is forwarded — no email, no name.
 */
export function SentryUser() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (user) {
      setUserContext({ id: user.id });
    } else {
      setUserContext(null);
    }
  }, [isLoaded, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
