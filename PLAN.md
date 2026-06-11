# Multi-Account Role & Organization System — Implementation Plan

> [!IMPORTANT]
> **This plan is historical.** The team feature described below was
> implemented in full (phases BP1–BP7 + linear steps 1–3). For the
> **current** data model, APIs, routing engine, and known gaps, see
> [`docs/TEAM_SPEC.md`](docs/TEAM_SPEC.md). This file is kept
> as a record of the original plan — any discrepancy between PLAN.md
> and TEAM_SPEC.md, TEAM_SPEC.md wins.

## Summary

Add three account levels to Koala:
1. **Rep** — default for every user, current solo workflow stays intact
2. **Manager** — self-serve team creation, invite reps, oversight dashboard at `/manager`
3. **Platform Admin** — existing `/admin` extended with manager/team/invitation management

---

## Architecture

### Domain Model

| Table | Purpose |
|---|---|
| `User` | Add `platform_role` (user \| admin). Existing Clerk metadata stays as middleware fast-path. |
| `Team` | Team entity. One owner per team. One team per owner (enforced by DB). |
| `TeamMembership` | Join table: user ↔ team with role (manager_owner \| manager_admin \| rep_member). |
| `Space` | Add nullable `teamId` FK. Rep workspace stays the atomic unit. |
| `Invitation` | Token-based invite. Pending until accepted or expired. |

### Roles

- **platform_role** on User: `user` (default) or `admin`
- **TeamMembership.role**: `manager_owner`, `manager_admin`, `rep_member`
- "Is a manager" = has any TeamMembership where role ∈ {manager_owner, manager_admin}

### Permissions (central helpers in `lib/permissions.ts`)

```
isPlatformAdmin(clerkUserId) → boolean    — checks DB platform_role (Clerk metadata fallback)
requirePlatformAdmin()       → { userId } — throws if not admin
getTeamForUser(userId)  → Team | null
requireManager()              → { team, membership } — throws if not manager
```

### Routing

| Route | Auth |
|---|---|
| `/manager` | requireManager() |
| `/manager/members` | requireManager() |
| `/manager/invitations` | requireManager() |
| `/invite/[token]` | Clerk auth required (sign in if not) |
| `/admin/teams` | requirePlatformAdmin() |
| `/admin/invitations` | requirePlatformAdmin() |

---

## Phase 1 — Database Migration

### Migration file: `supabase/migrations/20260314000003_org_system.sql`

```sql
-- 1. platform_role on User
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "platformRole" text NOT NULL DEFAULT 'user'
  CHECK ("platformRole" IN ('user', 'admin'));

-- 2. Team table
CREATE TABLE IF NOT EXISTS "Team" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text NOT NULL,
  "ownerId"   text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  "websiteUrl" text,
  "logoUrl"   text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_owner ON "Team"("ownerId");
CREATE INDEX IF NOT EXISTS idx_team_status ON "Team"(status);

-- 3. TeamMembership table
CREATE TABLE IF NOT EXISTS "TeamMembership" (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"  text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  "userId"       text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('manager_owner', 'manager_admin', 'rep_member')),
  "invitedById"  text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("teamId", "userId")
);
CREATE INDEX IF NOT EXISTS idx_membership_team ON "TeamMembership"("teamId");
CREATE INDEX IF NOT EXISTS idx_membership_user ON "TeamMembership"("userId");

-- 4. Add teamId to Space (nullable — existing spaces unaffected)
ALTER TABLE "Space"
  ADD COLUMN IF NOT EXISTS "teamId" text REFERENCES "Team"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_space_team ON "Space"("teamId");

-- 5. Invitation table
CREATE TABLE IF NOT EXISTS "Invitation" (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"  text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  email          text NOT NULL,
  "roleToAssign" text NOT NULL CHECK ("roleToAssign" IN ('manager_admin', 'rep_member')),
  token          text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  "expiresAt"    timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  "invitedById"  text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitation_team ON "Invitation"("teamId");
CREATE INDEX IF NOT EXISTS idx_invitation_email ON "Invitation"(email);
CREATE INDEX IF NOT EXISTS idx_invitation_token ON "Invitation"(token);
CREATE INDEX IF NOT EXISTS idx_invitation_status ON "Invitation"(status);

-- 6. RLS for new tables (service role bypasses; these are defense-in-depth)
ALTER TABLE "Team"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation"          ENABLE ROW LEVEL SECURITY;
```

### Schema.sql update
Add the same tables to `supabase/schema.sql` (source of truth for fresh installs).

---

## Phase 2 — Types & Permission Helpers

### `lib/types.ts` additions
```ts
export type PlatformRole = 'user' | 'admin';
export type MembershipRole = 'manager_owner' | 'manager_admin' | 'rep_member';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export type Team = {
  id: string; name: string; ownerId: string;
  status: 'active' | 'suspended'; websiteUrl: string | null;
  logoUrl: string | null; createdAt: Date;
};

export type TeamMembership = {
  id: string; teamId: string; userId: string;
  role: MembershipRole; invitedById: string | null; createdAt: Date;
};

export type Invitation = {
  id: string; teamId: string; email: string;
  roleToAssign: Omit<MembershipRole, 'manager_owner'>;
  token: string; status: InvitationStatus;
  expiresAt: Date; invitedById: string | null; createdAt: Date;
};
```

### `lib/permissions.ts` (new file)
```ts
// Central permission helpers — use these everywhere, never raw role checks.
isPlatformAdmin(clerkUserId)   → Promise<boolean>
requirePlatformAdmin()         → Promise<{ userId: string }>
getTeamForUser(dbUserId)  → Promise<{ team, membership } | null>
requireManager()                → Promise<{ team, membership, dbUserId }>
```

`isPlatformAdmin` checks `User.platformRole = 'admin'` in DB. Also checks Clerk metadata as fallback (backward compatible with any existing admins set via Clerk Dashboard).

### `lib/admin.ts` update
`requireAdmin()` delegates to `requirePlatformAdmin()` from `lib/permissions.ts`.

---

## Phase 3 — Middleware

`middleware.ts`: add `/manager` to protected route matchers so unauthenticated users get redirected to sign-in. Admin check in middleware stays as Clerk metadata (edge-compatible, no DB).

---

## Phase 4 — API Routes

### `POST /api/manager/create`
- Auth: any signed-in user with a completed workspace
- Creates Team row + TeamMembership (role: manager_owner)
- Enforces one team per owner (409 if exists)

### `POST /api/manager/invite`
- Auth: requireManager()
- Body: `{ email, role }` (role: rep_member | manager_admin)
- Creates Invitation row
- Sends email via Resend with `/invite/[token]` link
- Idempotent: if pending invite for same email exists, return existing (don't send duplicate)

### `GET /api/manager/stats`
- Auth: requireManager()
- Returns member counts, total leads, total applications across all member spaces

### `GET /api/invitations/[token]`
- Public read — returns team name + invitation details for the accept page
- Does NOT expose sensitive data

### `POST /api/invitations/[token]/accept`
- Auth: signed-in user
- Validates token (pending, not expired)
- Creates TeamMembership for the current user
- Links their Space.teamId
- Marks invitation accepted
- If user already a member: no-op (idempotent)

### `GET /api/admin/teams`
- Auth: requirePlatformAdmin()
- Returns all Team rows with owner info and member counts

### `GET /api/admin/invitations`
- Auth: requirePlatformAdmin()
- Returns all Invitation rows

### `PATCH /api/admin/teams/[id]`
- Auth: requirePlatformAdmin()
- Body: `{ status: 'active' | 'suspended' }`
- Suspends or reactivates a team

### `DELETE /api/admin/memberships/[id]`
- Auth: requirePlatformAdmin()
- Removes a TeamMembership (and unlinks Space.teamId)

---

## Phase 5 — Manager Dashboard

### `app/manager/layout.tsx`
- Server component: calls requireManager(), passes team to children
- Renders `ManagerShell` (sidebar + header matching existing admin shell style)
- Mobile responsive (same pattern as AdminShell)

### `app/manager/page.tsx` — Overview
Stats cards: Members, Pending invitations, Total leads across members, Total applications
Recent member list with activation status

### `app/manager/members/page.tsx`
Table of team members:
- Name, email, role badge, onboarding status badge, workspace slug, date joined

### `app/manager/invitations/page.tsx`
- Pending invitations table (email, role, sent date, expiry, status badge)
- Inline "Invite" form: email + role selector + Send button

### `components/manager/manager-shell.tsx`
Nav items: Overview, Members, Invitations
Back link to rep workspace
Same visual pattern as AdminShell

---

## Phase 6 — Invitation Accept Flow

### `app/invite/[token]/page.tsx`
- Public page (but redirects to sign-in if not authenticated)
- Shows: team name, inviting manager, role being assigned
- If authenticated: "Accept invitation" button
- If not authenticated: "Sign in to accept" → Clerk sign-in with redirect back to this page
- Error states: expired, already accepted, invalid token

---

## Phase 7 — Admin Dashboard Extension

### `app/admin/teams/page.tsx`
Cards showing each team: name, owner, member count, status badge, suspend/reactivate toggle

### `app/admin/invitations/page.tsx`
Full invitations table: team, email, role, status, expiry, invited by

### `app/admin/users/[id]/page.tsx` (extend existing)
Add team membership section: show which team (if any) the user belongs to, role, option to remove membership

### `app/admin/components/admin-shell.tsx` (extend)
Add nav items: Teams (Building2 icon), Invitations (Mail icon)

---

## Phase 8 — Navigation Updates

### `app/s/[slug]/layout.tsx` (extend)
Fetch manager membership for current user. If manager_owner or manager_admin, pass `isManager: true` to Sidebar.

### `components/dashboard/sidebar.tsx` (extend)
If `isManager`, add "Team" nav link (Building2 icon → `/manager`) in secondary nav section.

### `components/dashboard/mobile-nav.tsx` (extend)
If `isManager`, add Team to mobile bottom bar.

---

## Phase 9 — Email Template

### `lib/email.ts`
Add `sendTeamInvitation({ to, teamName, inviterName, role, token })` function.
Matches existing email style (plain HTML, same escape helpers, Resend via existing env var).

---

## Architecture Note (ARCHITECTURE.md)
Create short doc in repo root explaining:
- Roles and how they're determined
- Organization model (Team → Memberships → Spaces)
- Permission rules
- Invitation lifecycle

---

## Migration Safety

- `User.platformRole` defaults to `'user'` — all existing users unaffected
- `Space.teamId` is nullable — all existing spaces unaffected
- No existing tables dropped or renamed
- requireAdmin() backward compatible (checks both DB platformRole AND Clerk metadata)
- Public intake routes untouched
- Onboarding flow untouched

---

## File Change List

| File | Action |
|---|---|
| `supabase/schema.sql` | Add 3 new tables + Space.teamId + User.platformRole |
| `supabase/migrations/20260314000003_org_system.sql` | New migration |
| `lib/types.ts` | Add Team, TeamMembership, Invitation types |
| `lib/permissions.ts` | New: central permission helpers |
| `lib/admin.ts` | Update requireAdmin to delegate to permissions.ts |
| `lib/email.ts` | Add sendTeamInvitation() |
| `middleware.ts` | Add /manager to protected routes |
| `app/manager/layout.tsx` | New: manager layout |
| `app/manager/page.tsx` | New: manager overview |
| `app/manager/members/page.tsx` | New: members list |
| `app/manager/invitations/page.tsx` | New: invitations + invite form |
| `components/manager/manager-shell.tsx` | New: manager sidebar shell |
| `app/invite/[token]/page.tsx` | New: accept invitation page |
| `app/api/manager/create/route.ts` | New |
| `app/api/manager/invite/route.ts` | New |
| `app/api/manager/stats/route.ts` | New |
| `app/api/invitations/[token]/route.ts` | New |
| `app/api/admin/teams/route.ts` | New |
| `app/api/admin/teams/[id]/route.ts` | New |
| `app/api/admin/invitations/route.ts` | New |
| `app/api/admin/memberships/[id]/route.ts` | New |
| `app/admin/teams/page.tsx` | New |
| `app/admin/invitations/page.tsx` | New |
| `app/admin/users/[id]/page.tsx` | Extend |
| `app/admin/components/admin-shell.tsx` | Extend nav items |
| `app/s/[slug]/layout.tsx` | Fetch manager status, pass to Sidebar |
| `components/dashboard/sidebar.tsx` | Add Team link if manager |
| `components/dashboard/mobile-nav.tsx` | Add Team if manager |
| `ARCHITECTURE.md` | New: role/org/permission docs |
