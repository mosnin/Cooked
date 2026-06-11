-- ============================================================================
-- Heal schema drift on EXISTING databases (audit migration-integrity finding).
--
-- The in-place fixes in this PR (reordering 0514 after the AIUserProfile CREATE,
-- adding actorId to schema.sql + the audit_log migration) make a FRESH
-- schema.sql + migrations chain apply cleanly. But databases that were already
-- built the old way are stuck with missing columns, because those corrective
-- edits land "in the past" and a manual replay won't re-run them:
--
--   * AIUserProfile.role / zipCode / leadSources — the ALTER (formerly
--     20260514000001) ran BEFORE 20260603000002 created the table, so it
--     aborted and the columns were never added.
--   * AuditLog.actorId — schema.sql created AuditLog without it, so the
--     20260314000001 CREATE TABLE IF NOT EXISTS no-opped and the column was
--     never added.
--
-- This forward migration is the prod heal: every statement is idempotent
-- (ADD COLUMN IF NOT EXISTS), so it's a no-op on a DB that already has the
-- columns (including any built from the fixed fresh chain) and adds the missing
-- ones on a drifted DB. Column definitions match the originals exactly.
-- ============================================================================

ALTER TABLE "AIUserProfile" ADD COLUMN IF NOT EXISTS "role"        text;
ALTER TABLE "AIUserProfile" ADD COLUMN IF NOT EXISTS "zipCode"     text;
ALTER TABLE "AIUserProfile" ADD COLUMN IF NOT EXISTS "leadSources" text[] NOT NULL DEFAULT '{}';

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorId" text;
