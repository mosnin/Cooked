-- ============================================================================
-- Team-level integrations + per-member manager profile customization.
--
-- Two additive, tiered features for team owners/admins (NOT rep
-- members — that gate is enforced in the API layer via requireManager /
-- canEditSettings, see lib/permissions.ts):
--
--   1. "TeamIntegrationConnection" — the team analogue of
--      "IntegrationConnection" (20260525000000). Each admin/owner connects
--      their OWN third-party accounts (inbox, calendar, social) AT the
--      team level. Keyed on (teamId, userId, toolkit) so two
--      admins can each connect their own Gmail without colliding. Composio
--      still holds the OAuth tokens; this table holds the pointer + status +
--      audit, exactly like the rep table.
--
--   2. Per-member manager profile fields on "TeamMembership" — so an
--      owner/admin can present a profile (display name, title, bio, photo,
--      phone) within the team, mirroring the rep profile on
--      SpaceSetting. Per-member (not per-team) because each admin has
--      their own profile; the team's own identity already lives on the
--      "Team" row (name, logoUrl, websiteUrl).
--
-- Additive and idempotent: IF NOT EXISTS, nullable columns, no destructive
-- DDL. Does not touch "IntegrationConnection", "SpaceSetting", or any rep
-- flow.
-- ============================================================================

-- ── 1. Team-level integration connections ──────────────────────────────

CREATE TABLE IF NOT EXISTS "TeamIntegrationConnection" (
  "id"                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"          TEXT NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
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

-- One active connection per (team, userId, toolkit). Disconnect flips
-- the prior row's status to 'revoked' so this partial unique index stays
-- clean — same invariant the rep table holds.
CREATE UNIQUE INDEX IF NOT EXISTS "TeamIntegrationConnection_active_unique"
  ON "TeamIntegrationConnection" ("teamId", "userId", "toolkit")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "TeamIntegrationConnection_teamId_idx"
  ON "TeamIntegrationConnection" ("teamId", "status");

CREATE INDEX IF NOT EXISTS "TeamIntegrationConnection_userId_idx"
  ON "TeamIntegrationConnection" ("userId");

ALTER TABLE "TeamIntegrationConnection" ENABLE ROW LEVEL SECURITY;

-- ── 2. Per-member manager profile fields ─────────────────────────────────────
-- Mirror of the rep profile (SpaceSetting.bio / socialLinks / phoneNumber /
-- businessName / repPhotoUrl) but scoped to a single team member.

ALTER TABLE "TeamMembership" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "TeamMembership" ADD COLUMN IF NOT EXISTS "title"       TEXT;
ALTER TABLE "TeamMembership" ADD COLUMN IF NOT EXISTS "bio"         TEXT;
ALTER TABLE "TeamMembership" ADD COLUMN IF NOT EXISTS "photoUrl"    TEXT;
ALTER TABLE "TeamMembership" ADD COLUMN IF NOT EXISTS "phone"       TEXT;
