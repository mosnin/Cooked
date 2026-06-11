'use client';

/**
 * Brief settings — two switches the realtor cares about, no more.
 *
 *   On / Off  — opt out of the daily brief entirely.
 *   Time      — hour of day in the realtor's timezone.
 *
 * Configuration is failure to decide. We picked: 7 AM default, in-app
 * delivery only (B4 adds email + SMS), no audio. The brief is the
 * sentence on the morning surface; if a realtor wants more knobs,
 * the next thing they want is to ignore it. Don't give them either.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { BODY, BODY_MUTED, CAPTION, PRIMARY_PILL } from '@/lib/typography';

interface BriefSectionProps {
  slug: string;
}

const HOUR_OPTIONS: { value: number; label: string }[] = [
  { value: 6, label: '6:00 AM' },
  { value: 7, label: '7:00 AM' },
  { value: 8, label: '8:00 AM' },
  { value: 9, label: '9:00 AM' },
];

interface Snapshot {
  enabled: boolean;
  hour: number;
  emailDelivery: boolean;
  smsDelivery: boolean;
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  return (
    a.enabled === b.enabled &&
    a.hour === b.hour &&
    a.emailDelivery === b.emailDelivery &&
    a.smsDelivery === b.smsDelivery
  );
}

export function BriefSection({ slug }: BriefSectionProps) {
  const [enabled, setEnabled] = useState(true);
  const [hour, setHour] = useState<number>(7);
  const [timezone, setTimezone] = useState<string>('America/New_York');
  const [emailDelivery, setEmailDelivery] = useState(false);
  const [smsDelivery, setSmsDelivery] = useState(false);
  const [masterEmail, setMasterEmail] = useState(true);
  const [masterSms, setMasterSms] = useState(false);
  const [phoneOnFile, setPhoneOnFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendingTest, setSendingTest] = useState(false);
  // The last-saved snapshot — Save button stays disabled until the
  // realtor changes something. Saving a no-op is a small lie ("I saved
  // your changes") that erodes the calm-confidence voice.
  const lastSaved = useRef<Snapshot | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/spaces?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        const s = data.settings ?? data;
        if (typeof s.briefEnabled === 'boolean') setEnabled(s.briefEnabled);
        if (typeof s.briefHour === 'number') setHour(s.briefHour);
        if (typeof s.timezone === 'string') setTimezone(s.timezone);
        if (typeof s.briefEmail === 'boolean') setEmailDelivery(s.briefEmail);
        if (typeof s.briefSms === 'boolean') setSmsDelivery(s.briefSms);
        if (typeof s.notifications === 'boolean') setMasterEmail(s.notifications);
        if (typeof s.smsNotifications === 'boolean') setMasterSms(s.smsNotifications);
        if (typeof s.phoneNumber === 'string' && s.phoneNumber.trim().length > 0) {
          setPhoneOnFile(true);
        }
        lastSaved.current = {
          enabled: typeof s.briefEnabled === 'boolean' ? s.briefEnabled : true,
          hour: typeof s.briefHour === 'number' ? s.briefHour : 7,
          emailDelivery: typeof s.briefEmail === 'boolean' ? s.briefEmail : false,
          smsDelivery: typeof s.briefSms === 'boolean' ? s.briefSms : false,
        };
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  const current: Snapshot = { enabled, hour, emailDelivery, smsDelivery };
  const dirty = lastSaved.current ? !snapshotsEqual(current, lastSaved.current) : false;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/spaces', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          briefEnabled: enabled,
          briefHour: hour,
          briefEmail: emailDelivery,
          briefSms: smsDelivery,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not save.');
      }
      lastSaved.current = { enabled, hour, emailDelivery, smsDelivery };
      setSaved(true);
      toast.success('Daily brief saved.');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That tripped me up. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    setSendingTest(true);
    try {
      const res = await fetch('/api/agent/briefing/test', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Test send failed.');
      }
      toast.success('Test sent.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test send failed.');
    } finally {
      setSendingTest(false);
    }
  }

  if (loading) {
    return <div className="h-32 bg-foreground/[0.04] rounded-md animate-pulse" />;
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <p className={BODY_MUTED}>
        One focal sentence and three to five cards, delivered to the workspace
        each morning. Quiet days say so.
      </p>

      <div className="flex items-center justify-between gap-4 py-3 border-t border-border/60">
        <div className="min-w-0">
          <p className={`${BODY} font-medium`}>Daily brief</p>
          <p className={`${CAPTION} mt-0.5`}>
            On by default. Turn off to stop generating.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-4 py-3 border-t border-border/60 transition-opacity',
          !enabled && 'opacity-50',
        )}
      >
        <div className="min-w-0">
          <p className={`${BODY} font-medium`}>Time</p>
          <p className={`${CAPTION} mt-0.5`}>
            Delivered in <span className="text-foreground">{timezone}</span>.
          </p>
        </div>
        <select
          value={hour}
          onChange={(e) => setHour(parseInt(e.target.value, 10))}
          disabled={!enabled}
          className={cn(
            'h-9 px-3 rounded-md border border-border/70 bg-background text-sm',
            'focus:outline-none focus:ring-2 focus:ring-foreground/30',
            'disabled:cursor-not-allowed',
          )}
        >
          {HOUR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-4 py-3 border-t border-border/60 transition-opacity',
          (!enabled || !masterEmail) && 'opacity-50',
        )}
      >
        <div className="min-w-0">
          <p className={`${BODY} font-medium`}>Also send by email</p>
          <p className={`${CAPTION} mt-0.5`}>
            {masterEmail ? (
              'Headline + a tap to open. Off by default.'
            ) : (
              <>
                <Link
                  href={`/s/${slug}/settings?tab=privacy#notifications`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Turn on email notifications
                </Link>{' '}
                first.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={emailDelivery && masterEmail}
          onCheckedChange={setEmailDelivery}
          disabled={!enabled || !masterEmail}
        />
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-4 py-3 border-t border-border/60 transition-opacity',
          (!enabled || !masterSms || !phoneOnFile) && 'opacity-50',
        )}
      >
        <div className="min-w-0">
          <p className={`${BODY} font-medium`}>Also send by text</p>
          <p className={`${CAPTION} mt-0.5`}>
            {!masterSms ? (
              <>
                <Link
                  href={`/s/${slug}/settings?tab=privacy#notifications`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Turn on text notifications
                </Link>{' '}
                first.
              </>
            ) : !phoneOnFile ? (
              <>
                <Link
                  href={`/s/${slug}/settings?tab=you`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Add a phone number
                </Link>{' '}
                in Workspace settings first.
              </>
            ) : (
              'One line + the link. Off by default.'
            )}
          </p>
        </div>
        <Switch
          checked={smsDelivery && masterSms && phoneOnFile}
          onCheckedChange={setSmsDelivery}
          disabled={!enabled || !masterSms || !phoneOnFile}
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving || (!dirty && !saved)}
          className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Saving' : saved ? 'Saved' : 'Save changes'}
        </button>
        {(emailDelivery || smsDelivery) && enabled && (
          <button
            type="button"
            onClick={handleSendTest}
            disabled={sendingTest}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2 disabled:opacity-60"
          >
            {sendingTest ? 'Sending…' : 'Send me a test'}
          </button>
        )}
      </div>
    </form>
  );
}
