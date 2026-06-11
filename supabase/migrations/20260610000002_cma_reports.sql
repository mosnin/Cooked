-- CMA reports — a realtor generates a Comparative Market Analysis from a
-- subject property + comparable Property rows already in their workspace, then
-- shares a public link with a seller.
--
-- Fully in-house: comps are selected from the realtor's own Property table (no
-- MLS, no external API). The computed analysis (subject snapshot, chosen comps,
-- price range, $/sqft) is frozen into `payload` at publish time so the public
-- page renders a stable report even if the underlying Property rows later
-- change or get deleted. shareToken gates the public /cma/[token] route the way
-- PropertyPacket.token gates /packet/[token].
--
-- RLS is enabled with no policies: every read/write goes through the server
-- with the service-role key (same posture as SupportTicket + PropertyPacket),
-- so the table is closed to anon/auth roles by default.

CREATE TABLE IF NOT EXISTS "CmaReport" (
  "id"                TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "spaceId"           TEXT        NOT NULL,
  "subjectAddress"    TEXT        NOT NULL,
  "subjectPropertyId" TEXT,
  "shareToken"        TEXT        NOT NULL,
  "title"             TEXT,
  "status"            TEXT        NOT NULL DEFAULT 'draft'
    CHECK ("status" IN ('draft','published')),
  "payload"           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "CmaReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CmaReport_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE
);

-- The public page looks the report up by its token.
CREATE UNIQUE INDEX IF NOT EXISTS "CmaReport_shareToken_key"
  ON "CmaReport" ("shareToken");

-- The realtor's "my CMAs" list reads newest-first within a space.
CREATE INDEX IF NOT EXISTS "CmaReport_space_created_idx"
  ON "CmaReport" ("spaceId", "createdAt" DESC);

ALTER TABLE "CmaReport" ENABLE ROW LEVEL SECURITY;
