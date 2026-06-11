-- Backfill the "Brokerage"."joinCode" column.
--
-- This column was only ever declared in supabase/schema.sql and never had a
-- corresponding migration. Any database built from migrations/ alone was
-- missing it, which made join-by-code (app/api/broker/join/route.ts) and
-- join-code regeneration (app/api/broker/join-code/route.ts) throw
-- "column does not exist" at runtime.
--
-- This migration is additive and idempotent: it adds the column and the unique
-- index matching exactly what schema.sql declares. The UNIQUE constraint is
-- expressed via CREATE UNIQUE INDEX IF NOT EXISTS rather than an inline UNIQUE
-- on ADD COLUMN so the whole file is safely re-runnable.

ALTER TABLE "Brokerage" ADD COLUMN IF NOT EXISTS "joinCode" text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brokerage_join_code ON "Brokerage"("joinCode");
