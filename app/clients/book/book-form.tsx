'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarCheck } from 'lucide-react';
import { Field, TextInput, SubmitButton, FormError } from '../auth-ui';

export function BookTourForm({
  realtors,
  guestName,
  guestEmail,
  guestPhone,
}: {
  realtors: { slug: string; name: string }[];
  guestName: string;
  guestEmail: string;
  guestPhone: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(realtors[0]?.slug ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await fetch('/api/clients/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        startsAt: new Date(startsAt).toISOString(),
        propertyAddress,
        notes,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data.error as string) ?? "That didn't go through. Try again.");
      setPending(false);
      return;
    }
    setDone(true);
    setPending(false);
    setTimeout(() => router.push('/clients/dashboard'), 1400);
  }

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-5 py-4">
        <CalendarCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="text-sm font-medium text-foreground">Tour requested.</p>
          <p className="text-xs text-muted-foreground">Your agent will confirm the time.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-[420px] space-y-4">
      {realtors.length > 1 && (
        <Field label="Agent" htmlFor="slug">
          <select
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {realtors.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="When?" htmlFor="startsAt">
        <TextInput
          id="startsAt"
          type="datetime-local"
          required
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </Field>

      <Field label="Property (optional)" htmlFor="propertyAddress">
        <TextInput
          id="propertyAddress"
          value={propertyAddress}
          onChange={(e) => setPropertyAddress(e.target.value)}
          placeholder="25 Park Slope Place, Brooklyn"
          maxLength={500}
        />
      </Field>

      <Field label="Anything else? (optional)" htmlFor="notes">
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Bringing my partner; weekends are easiest."
          className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        />
      </Field>

      {/* identity is forced server-side from the session; shown read-only for clarity */}
      <p className="text-xs text-muted-foreground">
        Booking as {guestName || guestEmail}
        {guestPhone ? ` · ${guestPhone}` : ''}.
      </p>

      <FormError error={error} />
      <SubmitButton pending={pending}>
        {pending ? 'Booking…' : 'Request tour'}
      </SubmitButton>
    </form>
  );
}
