-- ============================================================================
-- Broker Chippi conversations move to their OWN tables (structural isolation).
--
-- THE BUG THIS CLOSES
-- Broker Chippi conversations and realtor Chippi conversations used to live in
-- the SAME "Conversation"/"Message" tables, both keyed by "spaceId" (the broker
-- owner's personal Space). They were distinguished ONLY by a title prefix
-- '[BROKER_CHIPPI] <brokerageId>'. That string-prefix boundary leaked
-- brokerage-private data onto the realtor dashboard whenever a guard was missed.
-- We eliminate the shared storage: broker conversations get their own tables,
-- keyed by "brokerageId", so the boundary is STRUCTURAL, not a string match.
--
-- THIS MIGRATION IS ADDITIVE AND IDEMPOTENT.
-- It creates the new tables, then copies the existing broker rows across. It
-- does NOT delete the original "Conversation"/"Message" rows. The realtor-side
-- guards (NOT LIKE '[BROKER_CHIPPI]%') already hide those rows from the realtor
-- surfaces, so leaving them in place is harmless and reversible. The destructive
-- purge of the old broker rows is DEFERRED to a separate, later migration, run
-- only after the owner has verified the new tables carry the full history.
--
-- Re-running this migration is safe: CREATE TABLE IF NOT EXISTS for the tables,
-- ON CONFLICT (id) DO NOTHING for every backfilled row.
--
-- Out of scope (still shared storage, migrate next): team chat
-- ('[BROKERAGE_CHAT]%' in "Conversation"/"Message", app/api/broker/chat/*).
-- ============================================================================

-- ── 1. New tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BrokerConversation" (
  "id"          text PRIMARY KEY,
  "brokerageId" text NOT NULL REFERENCES "Brokerage"(id) ON DELETE CASCADE,
  "title"       text NOT NULL DEFAULT 'New conversation',
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "BrokerConversation_brokerageId_updatedAt_idx"
  ON "BrokerConversation" ("brokerageId", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "BrokerMessage" (
  "id"             text PRIMARY KEY,
  "brokerageId"    text NOT NULL REFERENCES "Brokerage"(id) ON DELETE CASCADE,
  "conversationId" text NOT NULL REFERENCES "BrokerConversation"(id) ON DELETE CASCADE,
  "role"           text NOT NULL,
  "content"        text NOT NULL DEFAULT '',
  "blocks"         jsonb,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "BrokerMessage_conversationId_createdAt_idx"
  ON "BrokerMessage" ("conversationId", "createdAt");

-- ── 2. Backfill conversations (additive, non-destructive) ───────────────────
-- For every existing broker-Chippi "Conversation", create a "BrokerConversation"
-- with the SAME id so the URL "?conversationId=" links keep resolving. The
-- brokerageId is the FIRST whitespace-delimited token AFTER the prefix
-- '[BROKER_CHIPPI] ' (the title may have extra auto-title text after the id,
-- e.g. '[BROKER_CHIPPI] brk_123 Pipeline question' — we take only 'brk_123').
-- The JOIN to "Brokerage" guards the FK: a malformed title whose parsed token
-- is not a real brokerage id is simply skipped, so no FK violation is possible.

INSERT INTO "BrokerConversation" ("id", "brokerageId", "title", "createdAt", "updatedAt")
SELECT
  c."id",
  b."id" AS "brokerageId",
  c."title",
  c."createdAt",
  c."updatedAt"
FROM "Conversation" c
JOIN "Brokerage" b
  ON b."id" = split_part(substring(c."title" FROM char_length('[BROKER_CHIPPI] ') + 1), ' ', 1)
WHERE c."title" LIKE '[BROKER_CHIPPI] %'
ON CONFLICT ("id") DO NOTHING;

-- ── 3. Backfill messages (additive, non-destructive) ────────────────────────
-- Copy every "Message" whose conversation now exists in "BrokerConversation".
-- brokerageId comes from the matching "BrokerConversation" so it can never
-- disagree with the parent and can never violate the FK.

INSERT INTO "BrokerMessage" ("id", "brokerageId", "conversationId", "role", "content", "blocks", "createdAt")
SELECT
  m."id",
  bc."brokerageId",
  m."conversationId",
  m."role",
  m."content",
  m."blocks",
  m."createdAt"
FROM "Message" m
JOIN "BrokerConversation" bc
  ON bc."id" = m."conversationId"
ON CONFLICT ("id") DO NOTHING;

-- NOTE: No DELETE. The original "Conversation"/"Message" broker rows remain in
-- place. The purge is a separate, later migration run after owner verification.
