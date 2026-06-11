-- Brokerage property pool.
--
-- Lets a brokerage own properties centrally and assign them down to its member
-- realtors (the model chosen for Chippi-for-Brokers Phase 2).
--
--   * "brokerageId"     — non-null marks a Property as part of a brokerage pool.
--                         The broker creates it; "spaceId" stays the broker
--                         owner's Space (the pool's home) so the existing NOT
--                         NULL FK on "spaceId" holds without a data backfill.
--   * "assignedSpaceId" — the member realtor's Space the property is assigned
--                         to. NULL = unassigned, sitting in the pool. A realtor
--                         sees a pool property in their own workspace when
--                         "assignedSpaceId" = their space.
--
-- Additive + idempotent: no existing column is touched, both columns are
-- nullable, and every statement is IF NOT EXISTS. Personal (non-pool)
-- properties are unaffected — they keep "brokerageId" NULL and behave exactly
-- as before.

ALTER TABLE "Property"
  ADD COLUMN IF NOT EXISTS "brokerageId"     TEXT REFERENCES "Brokerage"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "assignedSpaceId" TEXT REFERENCES "Space"(id)     ON DELETE SET NULL;

-- Pool listing for a brokerage, newest first.
CREATE INDEX IF NOT EXISTS idx_property_brokerage
  ON "Property" ("brokerageId", "updatedAt" DESC)
  WHERE "brokerageId" IS NOT NULL;

-- A realtor's assigned pool properties.
CREATE INDEX IF NOT EXISTS idx_property_assigned_space
  ON "Property" ("assignedSpaceId")
  WHERE "assignedSpaceId" IS NOT NULL;
