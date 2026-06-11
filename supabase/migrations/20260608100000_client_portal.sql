-- Client Portal — end-user (applicant / tour-booker) accounts, fully separate
-- from the realtor Clerk auth. A client signs up with email + password; once
-- their email is verified, the portal aggregates every Contact (application)
-- and Tour that shares their email across ALL spaces — "one page by email".
--
-- These tables never touch the realtor auth path. Messaging, info-requests and
-- documents hang off the existing Contact so the realtor sees them in their
-- normal contact view.

-- ── Accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ClientUser" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email"           TEXT NOT NULL,                 -- as entered (display)
  "emailLower"      TEXT NOT NULL,                 -- canonical lookup key
  "passwordHash"    TEXT NOT NULL,                 -- scrypt: <saltHex>:<hashHex>
  "name"            TEXT,
  "phone"           TEXT,
  "emailVerifiedAt" TIMESTAMPTZ,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientUser_emailLower_key" ON "ClientUser"("emailLower");

-- ── One-time codes (verify email · passwordless login · reset) ───────────────
CREATE TABLE IF NOT EXISTS "ClientAuthCode" (
  "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "emailLower" TEXT NOT NULL,
  "codeHash"   TEXT NOT NULL,                       -- sha256(code)
  "purpose"    TEXT NOT NULL CHECK ("purpose" IN ('verify','login','reset')),
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  "consumedAt" TIMESTAMPTZ,
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ClientAuthCode_lookup_idx" ON "ClientAuthCode"("emailLower","purpose","expiresAt");

-- ── Client ↔ realtor messages (hang off the Contact) ─────────────────────────
CREATE TABLE IF NOT EXISTS "ClientMessage" (
  "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "contactId"  TEXT NOT NULL REFERENCES "Contact"(id) ON DELETE CASCADE,
  "spaceId"    TEXT NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "senderType" TEXT NOT NULL CHECK ("senderType" IN ('client','realtor')),
  "body"       TEXT NOT NULL,
  "readAt"     TIMESTAMPTZ,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ClientMessage_contact_idx" ON "ClientMessage"("contactId","createdAt");

-- ── Realtor → client "please send X" requests ────────────────────────────────
CREATE TABLE IF NOT EXISTS "ClientInfoRequest" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "contactId"   TEXT NOT NULL REFERENCES "Contact"(id) ON DELETE CASCADE,
  "spaceId"     TEXT NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "message"     TEXT NOT NULL,                      -- what's being asked for
  "status"      TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','fulfilled','dismissed')),
  "response"    TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "fulfilledAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "ClientInfoRequest_contact_idx" ON "ClientInfoRequest"("contactId","status");

-- ── Client-uploaded documents (Wasabi keys; hang off the Contact) ────────────
CREATE TABLE IF NOT EXISTS "ClientDocument" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "contactId"   TEXT NOT NULL REFERENCES "Contact"(id) ON DELETE CASCADE,
  "spaceId"     TEXT NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "fileKey"     TEXT NOT NULL,
  "fileName"    TEXT NOT NULL,
  "contentType" TEXT,
  "sizeBytes"   INTEGER,
  "uploadedBy"  TEXT NOT NULL DEFAULT 'client',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ClientDocument_contact_idx" ON "ClientDocument"("contactId","createdAt");

ALTER TABLE "ClientUser"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientAuthCode"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientMessage"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientInfoRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientDocument"    ENABLE ROW LEVEL SECURITY;
