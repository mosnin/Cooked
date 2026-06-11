-- ============================================================================
-- Organization System: Teams, Memberships, Invitations
-- ============================================================================
-- Adds:
--   1. User.platformRole (user | admin) — replaces Clerk-metadata-only admin
--   2. Team table
--   3. TeamMembership table
--   4. Space.teamId (nullable link to Team)
--   5. Invitation table
--
-- All new columns have safe defaults so existing rows are unaffected.
-- ============================================================================

-- 1. Add platform_role to User (defaults 'user' — all existing users safe)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "platformRole" text NOT NULL DEFAULT 'user'
  CHECK ("platformRole" IN ('user', 'admin'));

-- 2. Team
CREATE TABLE IF NOT EXISTS "Team" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          text NOT NULL,
  "ownerId"     text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  "websiteUrl"  text,
  "logoUrl"     text,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
-- One team per owner
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_owner  ON "Team"("ownerId");
CREATE INDEX       IF NOT EXISTS idx_team_status  ON "Team"(status);

-- 3. TeamMembership
CREATE TABLE IF NOT EXISTS "TeamMembership" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"   text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  "userId"        text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('manager_owner', 'manager_manager', 'rep_member')),
  "invitedById"   text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("teamId", "userId")
);
CREATE INDEX IF NOT EXISTS idx_membership_team ON "TeamMembership"("teamId");
CREATE INDEX IF NOT EXISTS idx_membership_user      ON "TeamMembership"("userId");

-- 4. Link Space → Team (nullable — all existing spaces untouched)
ALTER TABLE "Space"
  ADD COLUMN IF NOT EXISTS "teamId" text REFERENCES "Team"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_space_team ON "Space"("teamId");

-- 5. Invitation
CREATE TABLE IF NOT EXISTS "Invitation" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"   text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  email           text NOT NULL,
  "roleToAssign"  text NOT NULL CHECK ("roleToAssign" IN ('manager_manager', 'rep_member')),
  token           text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  "expiresAt"     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  "invitedById"   text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitation_team ON "Invitation"("teamId");
CREATE INDEX IF NOT EXISTS idx_invitation_email     ON "Invitation"(email);
CREATE INDEX IF NOT EXISTS idx_invitation_token     ON "Invitation"(token);
CREATE INDEX IF NOT EXISTS idx_invitation_status    ON "Invitation"(status);

-- 6. RLS for new tables (defense-in-depth; service role bypasses these)
ALTER TABLE "Team"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation"          ENABLE ROW LEVEL SECURITY;
