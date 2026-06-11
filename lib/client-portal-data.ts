/**
 * Client-portal data — aggregates everything tied to a verified client email
 * across ALL spaces: applications (Contact rows) and demos (Demo rows). This is
 * the "one page by email" surface. Read-only against rep data; the client's
 * verified email is the authorization boundary (only rows matching their email).
 */
import 'server-only';
import { supabase } from '@/lib/supabase';

export interface PortalApplication {
  contactId: string;
  name: string | null;
  status: string;
  statusNote: string | null;
  applicationRef: string | null;
  spaceId: string;
  repName: string | null;
  repSlug: string | null;
  createdAt: string;
}

export interface PortalDemo {
  id: string;
  propertyAddress: string | null;
  startsAt: string | null;
  status: string | null;
  spaceId: string;
  contactId: string | null;
  repName: string | null;
  repSlug: string | null;
}

export interface ClientPortalData {
  applications: PortalApplication[];
  demos: PortalDemo[];
  /** Contact ids this client owns (by verified email) — the scope for
   *  messaging, documents, and info-requests. */
  contactIds: string[];
}

type SpaceRel = { name?: string | null; slug?: string | null } | null;

/**
 * Pull the client's applications + demos by email. `email` MUST be the verified
 * session email — it is the only authorization check, so never pass an
 * unverified or caller-supplied address here.
 */
/** Escape LIKE/ILIKE metacharacters so a full email is matched literally (still
 *  case-insensitively) rather than as a pattern. `%` and `_` are legal in email
 *  local parts and were a wildcard-injection hole in the cross-client guard
 *  (e.g. a client registered as `%@gmail.com` would match every gmail contact). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export async function getClientPortalData(email: string): Promise<ClientPortalData> {
  const lower = email.trim().toLowerCase();

  const [{ data: contacts }, { data: demos }] = await Promise.all([
    supabase
      .from('Contact')
      .select(
        'id, name, email, applicationStatus, applicationStatusNote, applicationRef, spaceId, createdAt, Space(name, slug)',
      )
      .ilike('email', escapeLike(lower))
      .order('createdAt', { ascending: false }),
    supabase
      .from('Demo')
      .select('id, propertyAddress, startsAt, status, spaceId, contactId, guestEmail, Space(name, slug)')
      .ilike('guestEmail', lower)
      .order('startsAt', { ascending: false }),
  ]);

  const applications: PortalApplication[] = (contacts ?? []).map((c) => {
    const space = c.Space as SpaceRel;
    return {
      contactId: c.id as string,
      name: (c.name as string | null) ?? null,
      status: (c.applicationStatus as string | null) ?? 'received',
      statusNote: (c.applicationStatusNote as string | null) ?? null,
      applicationRef: (c.applicationRef as string | null) ?? null,
      spaceId: c.spaceId as string,
      repName: space?.name ?? null,
      repSlug: space?.slug ?? null,
      createdAt: c.createdAt as string,
    };
  });

  const portalDemos: PortalDemo[] = (demos ?? []).map((t) => {
    const space = t.Space as SpaceRel;
    return {
      id: t.id as string,
      propertyAddress: (t.propertyAddress as string | null) ?? null,
      startsAt: (t.startsAt as string | null) ?? null,
      status: (t.status as string | null) ?? null,
      spaceId: t.spaceId as string,
      contactId: (t.contactId as string | null) ?? null,
      repName: space?.name ?? null,
      repSlug: space?.slug ?? null,
    };
  });

  const contactIds = Array.from(
    new Set([
      ...applications.map((a) => a.contactId),
      ...portalDemos.map((t) => t.contactId).filter((id): id is string => Boolean(id)),
    ]),
  );

  return { applications, demos: portalDemos, contactIds };
}

/** Guard: does this verified email own this contact? Used by messaging / docs
 *  / info-request endpoints before any read or write on a contact. */
export async function clientOwnsContact(email: string, contactId: string): Promise<boolean> {
  const lower = email.trim().toLowerCase();
  const { data } = await supabase
    .from('Contact')
    .select('id')
    .eq('id', contactId)
    .ilike('email', escapeLike(lower))
    .maybeSingle();
  return Boolean(data);
}
