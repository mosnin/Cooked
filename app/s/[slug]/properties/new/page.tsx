'use client';

/**
 * /s/[slug]/properties/new — the standalone create flow for a listing.
 *
 * A property is a noun (the thing being sold). A deal is a verb (the
 * transaction on it). They earn different shapes; do not conflate. This
 * page is a single form, no wizard ceremony — every field except address
 * is optional, the form is one screen, the realtor is done in 30s.
 *
 * Submit → POST /api/properties → navigate to the new property's detail
 * page so the realtor can add photos / refine status next.
 */

import { useRouter, useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { PropertyForm } from '@/components/properties/property-form';
import type { Property } from '@/lib/types';

export default function NewPropertyPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: Partial<Property>) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, ...values }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't create that property.");
        return;
      }
      const created = (await res.json()) as Property;
      router.push(`/s/${slug}/properties/${created.id}`);
    } catch {
      toast.error("Couldn't create that property. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn('space-y-6 max-w-2xl mx-auto pb-12')}>
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Properties.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          New listing
        </h1>
        <p className={cn(BODY_MUTED)}>What are you taking to market?</p>
      </header>

      <PropertyForm
        onCancel={() => router.push(`/s/${slug}/properties`)}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel="Create listing"
      />
    </div>
  );
}
