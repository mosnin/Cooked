-- ============================================================================
-- Brokerage-level integrations + per-member broker profile customization.
--
-- Two additive, tiered features for brokerage owners/admins (NOT realtor
-- members — that gate is enforced in the API layer via requireBroker /
-- canEditSettings, see lib/permissions.ts):
--
--   1. "BrokerageIntegrationConnection" — the brokerage analogue of
--      "IntegrationConnection" (20260525000000). Each admin/owner connects
--      their OWN third-party accounts (inbox, calendar, social) AT the
--      brokerage level. Keyed on (brokerageId, userId, toolkit) so two
--      admins can each connect their own Gmail without colliding. Composio
--      still holds the OAuth tokens; this table holds the pointer + status +
--      audit, exactly like the realtor table.
--
--   2. Per-member broker profile fields on "BrokerageMembership" — so an
--      owner/admin can present a profile (display name, title, bio, photo,
--      phone) within the brokerage, mirroring the realtor profile on
--      SpaceSetting. Per-member (not per-brokerage) because each admin has
--      their own profile; the brokerage's own identity already lives on the
--      "Brokerage" row (name, logoUrl, websiteUrl).
--
-- Additive and idempotent: IF NOT EXISTS, nullable columns, no destructive
-- DDL. Does not touch "IntegrationConnection", "SpaceSetting", or any realtor
-- flow.
-- ============================================================================

-- ── 1. Brokerage-level integration connections ──────────────────────────────

CREATE TABLE IF NOT EXISTS "BrokerageIntegrationConnection" (
  "id"                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "brokerageId"          TEXT NOT NULL REFERENCES "Brokerage"(id) ON DELETE CASCADE,
  "userId"               TEXT NOT NULL,                    -- Clerk userId of the admin/owner who connected
  "toolkit"              TEXT NOT NULL,                    -- composio toolkit slug, e.g. 'gmail'
  "composioConnectionId" TEXT NOT NULL,                    -- the connected-account id Composio returns
  "status"               TEXT NOT NULL DEFAULT 'active'
                           CHECK ("status" IN ('active', 'expired', 'revoked', 'failed')),
  "label"                TEXT,                             -- human-readable: 'work@example.com'
  "lastError"            TEXT,                             -- on 'failed' / 'expired'
  "lastUsedAt"           TIMESTAMPTZ,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active connection per (brokerage, userId, toolkit). Disconnect flips
-- the prior row's status to 'revoked' so this partial unique index stays
-- clean — same invariant the realtor table holds.
CREATE UNIQUE INDEX IF NOT EXISTS "BrokerageIntegrationConnection_active_unique"
  ON "BrokerageIntegrationConnection" ("brokerageId", "userId", "toolkit")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "BrokerageIntegrationConnection_brokerageId_idx"
  ON "BrokerageIntegrationConnection" ("brokerageId", "status");

CREATE INDEX IF NOT EXISTS "BrokerageIntegrationConnection_userId_idx"
  ON "BrokerageIntegrationConnection" ("userId");

ALTER TABLE "BrokerageIntegrationConnection" ENABLE ROW LEVEL SECURITY;

-- ── 2. Per-member broker profile fields ─────────────────────────────────────
-- Mirror of the realtor profile (SpaceSetting.bio / socialLinks / phoneNumber /
-- businessName / realtorPhotoUrl) but scoped to a single brokerage member.

ALTER TABLE "BrokerageMembership" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "BrokerageMembership" ADD COLUMN IF NOT EXISTS "title"       TEXT;
ALTER TABLE "BrokerageMembership" ADD COLUMN IF NOT EXISTS "bio"         TEXT;
ALTER TABLE "BrokerageMembership" ADD COLUMN IF NOT EXISTS "photoUrl"    TEXT;
ALTER TABLE "BrokerageMembership" ADD COLUMN IF NOT EXISTS "phone"       TEXT;
