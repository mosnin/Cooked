# 06 Permissions Matrix

## Roles

- **Platform Admin** (User.platformRole = 'admin'): System-level access. Can view all users, teams, and invitations. One or more per platform.
- **Manager Owner** (TeamMembership.role = 'manager_owner'): Owns a team. Full access to manager portal. One per team.
- **Manager Manager** (TeamMembership.role = 'manager_admin'): Manages a team. Same as owner except cannot delete team.
- **Rep Member** (TeamMembership.role = 'rep_member'): Member of a team. Has own workspace. Sees team name in sidebar.
- **Solo Rep** (default, no team membership): Owns their workspace. Full access to their space.

## Route Access Matrix

| Route | Platform Admin | Manager Owner | Manager Manager | Rep Member | Solo Rep | Public |
|-------|---------------|-------------|----------------|----------------|-------------|--------|
| / (home/sign-in) | redirect | redirect | redirect | redirect | redirect | full |
| /sign-in, /sign-up | redirect | redirect | redirect | redirect | redirect | full |
| /login/manager | redirect | redirect | redirect | redirect | redirect | full |
| /login/rep | redirect | redirect | redirect | redirect | redirect | full |
| /dashboard | full | full | full | full | full | none |
| /setup | full | full | full | full | full | none |
| /s/[slug] (own space) | full | full | full | full | full | none |
| /s/[slug]/leads | full | full | full | full | full | none |
| /s/[slug]/contacts | full | full | full | full | full | none |
| /s/[slug]/deals | full | full | full | full | full | none |
| /s/[slug]/demos | full | full | full | full | full | none |
| /s/[slug]/analytics | full | full | full | full | full | none |
| /s/[slug]/ai | full | full | full | full | full | none |
| /s/[slug]/profile | full | full | full | full | full | none |
| /s/[slug]/settings | full | full | full | full | full | none |
| /s/[slug]/configure | full | full | full | full | full | none |
| /s/[slug]/billing | full | full | full | full | full | none |
| /manager | none | full | full | none | none | none |
| /manager/reps | none | full | full | none | none | none |
| /manager/members | none | full | full | none | none | none |
| /manager/invitations | none | full | full | none | none | none |
| /manager/settings | none | full | view | none | none | none |
| /admin | full | none | none | none | none | none |
| /admin/users | full | none | none | none | none | none |
| /admin/teams | full | none | none | none | none | none |
| /admin/invitations | full | none | none | none | none | none |
| /apply/[slug] | full | full | full | full | full | full |
| /book/[slug] | full | full | full | full | full | full |
| /invite/[token] | full | full | full | full | full | full |
| /join/[code] | full | full | full | full | full | full |
| /pricing | full | full | full | full | full | full |
| /features | full | full | full | full | full | full |
| /faq | full | full | full | full | full | full |
| /legal/* | full | full | full | full | full | full |

## Enforcement Rules

- **Middleware layer** (`middleware.ts`): Clerk middleware protects all routes matching `/dashboard`, `/s/*`, `/setup`, `/admin`, `/manager`, `/invite/*`, `/join/*`, `/auth/*`. Admin routes additionally check `sessionClaims.publicMetadata.role === 'admin'`.
- **API layer**: Each API route calls `auth()` for userId. Admin routes call `requirePlatformAdmin()`. Manager routes call `requireManager()`. Space routes verify space ownership via `getCurrentDbUser()` + space lookup.
- **UI layer**: Sidebar conditionally shows manager nav link based on `isManager` prop. Admin nav only shown to admins. Team name shown to team members.
- **Data isolation**: All space data is filtered by `spaceId`. Layout verifies `dbUser.space.id === space.id` to prevent cross-space access.

## Notes

- Platform Admin is assigned via User.platformRole in DB or Clerk publicMetadata.role (backwards compat).
- Manager roles are derived from TeamMembership records, not User fields.
- A user can be both a rep (own space) and a manager (accountType='both').
- Space ownership is 1:1 — one user, one space. Space.ownerId is UNIQUE.
- Authenticated users visiting sign-in/sign-up pages are redirected to `/`.
