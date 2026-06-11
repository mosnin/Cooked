import { NextResponse, type NextRequest } from 'next/server';
import { getClientUser } from '@/lib/client-auth';
import { getClientPortalData } from '@/lib/client-portal-data';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/clients/book — portal tour booking. A thin proxy over the existing
 * public /api/tours/book endpoint: it forces guestEmail/guestName/guestPhone
 * from the verified session (so a client can only book under their own email)
 * and restricts the realtor to one the client is already engaged with. The
 * underlying booking logic is untouched — we just call it.
 */
export async function POST(req: NextRequest) {
  const user = await getClientUser();
  if (!user?.emailVerifiedAt) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    slug?: string;
    startsAt?: string;
    propertyAddress?: string;
    notes?: string;
  };
  const slug = (body.slug ?? '').trim();
  const startsAt = body.startsAt;
  if (!slug || !startsAt) {
    return NextResponse.json({ error: 'slug and startsAt are required' }, { status: 400 });
  }

  // Only let the client book with a realtor they already have a relationship
  // with (an application or tour on their verified email).
  const { applications, tours } = await getClientPortalData(user.email);
  const engagedSlugs = new Set(
    [...applications.map((a) => a.realtorSlug), ...tours.map((t) => t.realtorSlug)].filter(
      (s): s is string => Boolean(s),
    ),
  );
  if (!engagedSlugs.has(slug)) {
    return NextResponse.json({ error: 'You can only book with an agent you already work with.' }, { status: 403 });
  }

  const { allowed } = await checkRateLimit(`clients:book:${user.id}`, 5, 3600);
  if (!allowed) return NextResponse.json({ error: 'Too many bookings. Try again later.' }, { status: 429 });

  // Call the existing public booking endpoint with the session identity forced.
  const origin = req.nextUrl.origin;
  const res = await fetch(`${origin}/api/tours/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      guestName: user.name ?? user.email,
      guestEmail: user.email,
      guestPhone: user.phone ?? undefined,
      propertyAddress: body.propertyAddress?.slice(0, 500) || undefined,
      notes: body.notes?.slice(0, 2000) || undefined,
      startsAt,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? 'Booking failed.' }, { status: res.status });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
