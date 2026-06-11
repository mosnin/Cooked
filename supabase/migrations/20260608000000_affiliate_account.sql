-- Affiliate program — stores the FirstPromoter promoter id + referral link
-- for each Chippi workspace. One row per space (UNIQUE on spaceId).
--
-- spaceId FK cascades on delete so if a workspace is removed the affiliate
-- row goes with it — no orphaned FP references.
--
-- fpPromoterId   The numeric/string id from FP's /company/promoters endpoint.
--                Used to fetch fresh stats via GET /company/promoters/{id}.
-- refLink        The full ?fpr= referral URL from FP (front-facing, shareable).
-- refToken       The short token component (used for fpr.js cookie attribution).

CREATE TABLE IF NOT EXISTS "AffiliateAccount" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"        TEXT        NOT NULL,
  "spaceId"       TEXT        NOT NULL,
  "fpPromoterId"  TEXT        NOT NULL,
  "refLink"       TEXT        NOT NULL,
  "refToken"      TEXT        NOT NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "AffiliateAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateAccount_spaceId_key" UNIQUE ("spaceId"),
  CONSTRAINT "AffiliateAccount_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE
);

-- Index for fast lookup by userId (for "find my affiliate row" queries).
CREATE INDEX IF NOT EXISTS "AffiliateAccount_userId_idx"
  ON "AffiliateAccount" ("userId");
