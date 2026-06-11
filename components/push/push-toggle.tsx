'use client';

import { useState, useEffect, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { BODY, CAPTION } from '@/lib/typography';

interface PushToggleProps {
  slug: string;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** URL-base64 → Uint8Array, the format pushManager.subscribe() wants for its key. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Push notifications toggle. Registers the service worker, asks for permission,
 * subscribes the browser, and posts the subscription to the server. Flipping it
 * off unsubscribes the browser and tells the server to forget it.
 *
 * Renders nothing if push isn't configured (no VAPID public key) or the browser
 * can't do push — there's no point showing a switch that can only fail.
 */
export function PushToggle({ slug }: PushToggleProps) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const ok =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      Boolean(VAPID_PUBLIC_KEY);
    setSupported(ok);
    if (!ok) return;

    setDenied(Notification.permission === 'denied');

    // Reflect existing subscription state.
    navigator.serviceWorker
      .getRegistration('/sw.js')
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setEnabled(Boolean(sub)))
      .catch(() => {});
  }, []);

  const subscribe = useCallback(async () => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setDenied(permission === 'denied');
      throw new Error(
        permission === 'denied'
          ? 'Notifications are blocked. Enable them in your browser settings.'
          : 'Permission was not granted.',
      );
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    });

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, subscription: sub.toJSON() }),
    });
    if (!res.ok) {
      await sub.unsubscribe().catch(() => {});
      throw new Error('Could not save your subscription. Try again.');
    }
  }, [slug]);

  const unsubscribe = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  }, [slug]);

  async function handleToggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        await subscribe();
        setEnabled(true);
        toast.success('Push notifications on.');
      } else {
        await unsubscribe();
        setEnabled(false);
        toast.success('Push notifications off.');
      }
    } catch (err) {
      setEnabled(false);
      toast.error(err instanceof Error ? err.message : 'That tripped me up. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className={`${BODY} font-medium`}>Push notifications on this device</p>
        <p className={`${CAPTION} mt-0.5`}>
          {denied
            ? 'Blocked. Allow notifications for Chippi in your browser settings, then try again.'
            : "Get a native alert the moment a lead, tour, or deal lands — even when Chippi isn't open."}
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={handleToggle} disabled={busy || denied} />
    </div>
  );
}
