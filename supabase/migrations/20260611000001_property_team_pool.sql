-- Team property pool.
--
-- Lets a team own properties centrally and assign them down to its member
-- reps (the model chosen for Koala-for-Managers Phase 2).
--
--   * "teamId"     — non-null marks a Property as part of a team pool.
--                         The manager creates it; "spaceId" stays the manager
--                         owner's Space (the pool's home) so the existing NOT
--                         NULL FK on "spaceId" holds without a data backfill.
--   * "assignedSpaceId" — the member rep's Space the property is assigned
--                         to. NULL = unassigned, sitting in the pool. A rep
--                         sees a pool property in their own workspace when
--                         "assignedSpaceId" = their space.
--
-- Additive + idempotent: no existing column is touched, both columns are
-- nullable, and every statement is IF NOT EXISTS. Personal (non-pool)
-- properties are unaffected — they keep "teamId" NULL and behave exactly
-- as before.

ALTER TABLE "Property"
  ADD COLUMN IF NOT EXISTS "teamId"     TEXT REFERENCES "Team"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "assignedSpaceId" TEXT REFERENCES "Space"(id)     ON DELETE SET NULL;

-- Pool listing for a team, newest first.
CREATE INDEX IF NOT EXISTS idx_property_team
  ON "Property" ("teamId", "updatedAt" DESC)
  WHERE "teamId" IS NOT NULL;

-- A rep's assigned pool properties.
CREATE INDEX IF NOT EXISTS idx_property_assigned_space
  ON "Property" ("assignedSpaceId")
  WHERE "assignedSpaceId" IS NOT NULL;
