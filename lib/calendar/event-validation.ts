/**
 * Calendar event creation validator — pure, framework-agnostic, no
 * Next.js or supabase imports. Lives outside `app/api/.../route.ts`
 * because Next's App Router rejects non-handler exports from a
 * `route.ts` file ("X is not a valid Route export field"). Pulling
 * the validator out keeps the route file's exports clean (GET, POST)
 * and lets the unit tests import without dragging the route shape.
 */

export interface CreateEventBody {
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  startDate?: unknown; // "YYYY-MM-DD"
  startTime?: unknown; // "HH:MM" (omitted/ignored when allDay)
  endDate?: unknown; // "YYYY-MM-DD"
  endTime?: unknown; // "HH:MM"
  allDay?: unknown;
  attendees?: unknown; // string[] of emails
}

export interface ValidatedCreate {
  title: string;
  description: string | null;
  allDay: boolean;
  /** ISO 8601 with local timezone offset for timed; YYYY-MM-DD for all-day. */
  startsAt: string;
  /** Same shape as startsAt. For all-day Google wants end EXCLUSIVE (next day). */
  endsAt: string;
  attendees: { email: string }[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Pure validator — returns the normalized payload or an error string
 * explaining what's wrong. No throws.
 */
export function validateCreatePayload(
  body: CreateEventBody,
): { ok: true; value: ValidatedCreate } | { ok: false; error: string } {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return { ok: false, error: 'Title is required.' };
  if (title.length > 250) return { ok: false, error: 'Title too long.' };

  const description = typeof body.description === 'string' ? body.description.trim() : '';

  const allDay = body.allDay === true;

  const startDate = typeof body.startDate === 'string' ? body.startDate : '';
  if (!DATE_RE.test(startDate)) return { ok: false, error: 'Start date required.' };
  const endDate = typeof body.endDate === 'string' && body.endDate ? body.endDate : startDate;
  if (!DATE_RE.test(endDate)) return { ok: false, error: 'End date invalid.' };

  let startsAt: string;
  let endsAt: string;

  if (allDay) {
    // `writeEventThrough` posts via Composio's `start_datetime` /
    // `end_datetime` fields, which want a datetime string. Represent an
    // all-day event as a 24-hour timed event from local midnight to the
    // next day's midnight — Google renders this visually identical to a
    // true all-day event for the realtor, and we avoid a fragile date-
    // only path through the Composio wrapper. v2 can branch to true
    // all-day when we extend `writeEventThrough`.
    if (endDate < startDate) return { ok: false, error: 'End date is before start.' };
    startsAt = toLocalISO(startDate, '00:00');
    const [ey, em, ed] = endDate.split('-').map(Number);
    const nextDay = new Date(ey, em - 1, ed + 1, 0, 0, 0, 0);
    const ny = nextDay.getFullYear();
    const nm = String(nextDay.getMonth() + 1).padStart(2, '0');
    const nd = String(nextDay.getDate()).padStart(2, '0');
    endsAt = toLocalISO(`${ny}-${nm}-${nd}`, '00:00');
  } else {
    const startTime = typeof body.startTime === 'string' ? body.startTime : '';
    const endTime = typeof body.endTime === 'string' ? body.endTime : '';
    if (!TIME_RE.test(startTime)) return { ok: false, error: 'Start time required.' };
    if (!TIME_RE.test(endTime)) return { ok: false, error: 'End time required.' };

    startsAt = toLocalISO(startDate, startTime);
    endsAt = toLocalISO(endDate, endTime);
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return { ok: false, error: 'End must be after start.' };
    }
  }

  const attendeesRaw = Array.isArray(body.attendees) ? body.attendees : [];
  if (attendeesRaw.length > 50) return { ok: false, error: 'Too many attendees.' };
  const attendees: { email: string }[] = [];
  for (const raw of attendeesRaw) {
    if (typeof raw !== 'string') return { ok: false, error: 'Invalid attendee.' };
    const email = raw.trim();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) return { ok: false, error: `Invalid email: ${email}` };
    attendees.push({ email });
  }

  return {
    ok: true,
    value: {
      title,
      description: description || null,
      allDay,
      startsAt,
      endsAt,
      attendees,
    },
  };
}

/** Build an ISO 8601 timestamp with the server's local timezone offset. */
function toLocalISO(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const local = new Date(y, mo - 1, d, hh, mm, 0, 0);
  const offsetMin = -local.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${sign}${offH}:${offM}`;
}
