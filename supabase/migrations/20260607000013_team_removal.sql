-- TeamRemoval — deny-list for members who have been removed from a
-- team. Pairs with the /manager/join route's anonymous-code path
-- to prevent a removed agent from silently re-joining via the same
-- invite code that's still circulating in their email.
--
-- Why not soft-delete on TeamMembership? 38 query sites read
-- that table; adding a `status='active'` predicate to all of them is
-- a big refactor that risks introducing latent bugs. A separate
-- deny-list table is small surface, easy to verify, and only the
-- two routes that care (members/[id] DELETE writes; manager/join
-- POST reads) need to know about it.
--
-- Re-hire path: deliberate. A removed agent can still come back via
-- an explicit manager-issued Invitation (the /api/invitations/[token]
-- POST flow) — that path does NOT consult this table. Anonymous
-- join codes are the one we close off. A manager can also clear an
-- entry from this table to re-allow code-based join if they decide
-- to rescind a removal.

CREATE TABLE IF NOT EXISTS "TeamRemoval" (
  "teamId" text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  "userId"      text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "removedAt"   timestamptz NOT NULL DEFAULT now(),
  "removedById" text REFERENCES "User"(id) ON DELETE SET NULL,
  "reason"      text,
  PRIMARY KEY ("teamId", "userId")
);

CREATE INDEX IF NOT EXISTS idx_team_removal_user
  ON "TeamRemoval" ("userId");

-- RLS: service-role-only writes (server-only flow). No client read paths.
ALTER TABLE "TeamRemoval" ENABLE ROW LEVEL SECURITY;
