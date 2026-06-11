-- ============================================================================
-- One pending invitation per (team, email) — close a seat-cap race.
--
-- checkSeatCapacity COUNTs members + pending invites then INSERTs, with no DB
-- constraint behind it. Two concurrent invites to the SAME email both pass the
-- "already pending?" pre-check and create two pending rows = two seats consumed
-- for one person, overshooting the plan's paid seat cap. A unique index makes
-- the duplicate physically impossible (the second insert fails, the route's
-- existing error handling reports it).
--
-- Pre-dedup: collapse any existing duplicate pending invites (keep the newest
-- per team+email) so the index can build on a live table.
--
-- ✓ VALIDATED on PostgreSQL 16: dedup runs, index builds, a second pending
--   invite to the same email is rejected, a different email is allowed, and a
--   re-invite after the first is accepted/expired is allowed.
-- ============================================================================

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "teamId", lower(email)
           ORDER BY "createdAt" DESC, id DESC
         ) AS rn
    FROM "Invitation"
   WHERE status = 'pending'
)
UPDATE "Invitation" SET status = 'expired'
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invitation_pending_email
  ON "Invitation" ("teamId", lower(email))
  WHERE status = 'pending';
