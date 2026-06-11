-- Axil practice — ICPs + mock sales calls.
--
-- A manager or rep defines an Ideal Customer Profile (an "Icp"): the kind of
-- prospect they sell to, captured as a persona (industry, company size, role,
-- pain points, objections, budget band, buying process, temperament). Axil then
-- roleplays a prospect drawn from that ICP in a text-based mock sales call
-- (a "MockCall"): the rep pitches, Axil pushes back in character, and when the
-- call ends Axil scores the rep on a coaching rubric and writes feedback.
--
-- Both tables are space-scoped like the rest of the rep-facing substrate
-- (CallLog, Contact, Deal): spaceId FK → Space, ON DELETE CASCADE. RLS is
-- ENABLED but no policies are added — every read/write goes through the server
-- with the service-role key (same closed posture as CallLog / the client-portal
-- tables), so the tables are closed to anon/auth roles by default. The three
-- starter ICPs are seeded once per fresh install; the partial unique index on
-- (spaceId, name) keeps a space from accumulating duplicate ICPs.

-- ── Icp — a reusable prospect persona a space practices against ──────────────

CREATE TABLE IF NOT EXISTS "Icp" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "spaceId"     TEXT,
  "name"        TEXT        NOT NULL,
  "description" TEXT,
  -- persona shape (validated app-side in lib/mock-calls/icp.ts):
  --   { industry, company_size, role, pain_points[], objections[],
  --     budget_band, buying_process, temperament }
  "persona"     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  "isDefault"   BOOLEAN     NOT NULL DEFAULT false,
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "Icp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Icp_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE
);

-- The practice surface lists a space's ICPs, defaults first then newest.
CREATE INDEX IF NOT EXISTS "Icp_spaceId_createdAt_idx"
  ON "Icp" ("spaceId", "createdAt" DESC);

-- One ICP name per space — keeps the picker tidy and edits idempotent. The
-- seeded defaults (spaceId NULL) are excluded so every space can also name an
-- ICP "Enterprise IT director" without colliding with a global default.
CREATE UNIQUE INDEX IF NOT EXISTS "Icp_spaceId_name_key"
  ON "Icp" ("spaceId", "name")
  WHERE "spaceId" IS NOT NULL;

ALTER TABLE "Icp" ENABLE ROW LEVEL SECURITY;

-- ── MockCall — one practice session against an ICP ───────────────────────────

CREATE TABLE IF NOT EXISTS "MockCall" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "spaceId"    TEXT        NOT NULL,
  "userId"     TEXT,
  "icpId"      TEXT,
  "scenario"   TEXT,
  "status"     TEXT        NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued','live','completed','abandoned')),
  -- transcript: ordered array of { role: 'rep'|'prospect', content, at }
  "transcript" JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- score: overall 0-100, null until the call is scored
  "score"      NUMERIC,
  -- feedback: { rubric:{discovery,objection_handling,value_articulation,
  --   closing,talk_ratio}, overall, tips[], best_moment, worst_moment }
  "feedback"   JSONB,
  "startedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "endedAt"    TIMESTAMPTZ,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "MockCall_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MockCall_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE,
  -- An ICP can be deleted while a past practice session still references it;
  -- keep the session but null the link (it carries its own scenario + transcript).
  CONSTRAINT "MockCall_icpId_fkey"
    FOREIGN KEY ("icpId") REFERENCES "Icp"("id") ON DELETE SET NULL
);

-- The practice history lists a space's sessions newest-first.
CREATE INDEX IF NOT EXISTS "MockCall_spaceId_createdAt_idx"
  ON "MockCall" ("spaceId", "createdAt" DESC);

-- A rep reviews their own past practice sessions.
CREATE INDEX IF NOT EXISTS "MockCall_userId_createdAt_idx"
  ON "MockCall" ("userId", "createdAt" DESC);

ALTER TABLE "MockCall" ENABLE ROW LEVEL SECURITY;

-- ── Seed: three starter ICPs (global defaults, spaceId NULL) ─────────────────
-- Idempotent: only inserts when no default of that name exists yet, so re-running
-- the migration (or layering it over an existing DB) never duplicates them.

INSERT INTO "Icp" ("name", "description", "persona", "isDefault")
SELECT
  'SMB SaaS founder',
  'Scrappy, time-poor founder of a 10-40 person SaaS company. Buys fast when ROI is obvious, allergic to fluff and long sales cycles.',
  '{
    "industry": "B2B SaaS",
    "company_size": "10-40 employees",
    "role": "Founder / CEO",
    "pain_points": ["wearing too many hats", "manual busywork eating the team", "needs to show traction to investors"],
    "objections": ["we are too small for this", "I can build a scrappy version myself", "no budget until next raise", "is this going to be another tool nobody uses"],
    "budget_band": "$200-1,000/mo, signs off personally",
    "buying_process": "Single decision-maker, wants a 14-day trial, decides in days not weeks",
    "temperament": "Direct, impatient, skeptical of hype but warms up fast to concrete ROI and peer proof"
  }'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "Icp" WHERE "name" = 'SMB SaaS founder' AND "spaceId" IS NULL
);

INSERT INTO "Icp" ("name", "description", "persona", "isDefault")
SELECT
  'Enterprise IT director',
  'Risk-averse IT director at a 2,000+ employee enterprise. Cares about security, integrations, and not being the person who picked the tool that failed.',
  '{
    "industry": "Enterprise (Financial Services / Healthcare)",
    "company_size": "2,000+ employees",
    "role": "Director of IT / Head of Infrastructure",
    "pain_points": ["legacy systems no one wants to touch", "security and compliance exposure", "too many point solutions to govern"],
    "objections": ["how does this handle SOC 2 and SSO", "we have a procurement process and a vendor freeze", "we already pay an incumbent for this", "what happens to our data", "I need security review and a pilot before any commitment"],
    "budget_band": "$50k-250k/yr, committee + procurement sign-off",
    "buying_process": "Multi-stakeholder: security review, legal/MSA, procurement, 60-90 day cycle",
    "temperament": "Measured, guarded, detail-driven. Distrusts pressure; rewards reps who respect process and answer security questions crisply"
  }'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "Icp" WHERE "name" = 'Enterprise IT director' AND "spaceId" IS NULL
);

INSERT INTO "Icp" ("name", "description", "persona", "isDefault")
SELECT
  'Mid-market RevOps lead',
  'Analytical RevOps leader at a 200-800 person company. Owns the tech stack and the number; wants data, clean integrations, and a clear path to adoption.',
  '{
    "industry": "Mid-market B2B",
    "company_size": "200-800 employees",
    "role": "RevOps / Sales Operations Lead",
    "pain_points": ["dirty CRM data", "reps not adopting the tools they have", "no clean attribution from lead to revenue", "stack sprawl"],
    "objections": ["how does this integrate with our CRM", "will the reps actually use it", "we are mid-implementation on something else", "I need to see the data before I expand", "who owns this internally after we buy"],
    "budget_band": "$1k-10k/mo, recommends to VP/CRO for approval",
    "buying_process": "Champion-led: builds the business case, runs a pilot with a rep pod, 30-45 day cycle",
    "temperament": "Pragmatic, data-hungry, collaborative. Buys when shown clean integrations, adoption proof, and measurable lift"
  }'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "Icp" WHERE "name" = 'Mid-market RevOps lead' AND "spaceId" IS NULL
);
