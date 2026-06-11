-- Restore Realtime as a functional product surface.
--
-- The previous migration (20260409_fix_realtime_rls.sql) replaced the
-- old USING(true) anon policies with USING(false), correctly closing a
-- cross-tenant leak — but it also killed every Realtime subscription
-- because the browser client connects with the anon key. Every "live"
-- toast in components/dashboard/live-notifications.tsx and every
-- subscription in notification-center.tsx silently fired zero events,
-- masked by the 5-minute polling fallback.
--
-- This migration restores live updates the right way: switch the
-- subscribing role to `authenticated` and scope each policy to the
-- caller's spaces via auth.jwt() ->> 'sub' → User.clerkId → Space.ownerId.
-- The Clerk JWT bridge (lib/supabase-browser.ts + hooks/use-supabase-
-- realtime-auth.ts) feeds the JWT into Realtime; this migration owns
-- the database side of the contract.
--
-- Tenant scoping rule (single predicate, four tables): a Contact / Deal /
-- DealStage / Tour row is readable if its spaceId belongs to a Space
-- whose owner's clerkId matches the JWT's `sub` claim. Brokerage members
-- with shared access via BrokerageMembership are out of scope for this
-- pass — they currently see zero events (same as today), and we'll add
-- their predicate in a follow-up once we observe the realtor path
-- working in production.

-- ── Contact ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "deny_anon_contact_select" ON "Contact";

CREATE POLICY "realtime_authenticated_contact_select" ON "Contact"
  FOR SELECT TO authenticated
  USING (
    "spaceId" IN (
      SELECT s.id FROM "Space" s
      JOIN "User" u ON u.id = s."ownerId"
      WHERE u."clerkId" = auth.jwt() ->> 'sub'
    )
  );

-- ── Deal ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "deny_anon_deal_select" ON "Deal";

CREATE POLICY "realtime_authenticated_deal_select" ON "Deal"
  FOR SELECT TO authenticated
  USING (
    "spaceId" IN (
      SELECT s.id FROM "Space" s
      JOIN "User" u ON u.id = s."ownerId"
      WHERE u."clerkId" = auth.jwt() ->> 'sub'
    )
  );

-- ── DealStage ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "deny_anon_dealstage_select" ON "DealStage";

CREATE POLICY "realtime_authenticated_dealstage_select" ON "DealStage"
  FOR SELECT TO authenticated
  USING (
    "spaceId" IN (
      SELECT s.id FROM "Space" s
      JOIN "User" u ON u.id = s."ownerId"
      WHERE u."clerkId" = auth.jwt() ->> 'sub'
    )
  );

-- ── Tour ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "deny_anon_tour_select" ON "Tour";

CREATE POLICY "realtime_authenticated_tour_select" ON "Tour"
  FOR SELECT TO authenticated
  USING (
    "spaceId" IN (
      SELECT s.id FROM "Space" s
      JOIN "User" u ON u.id = s."ownerId"
      WHERE u."clerkId" = auth.jwt() ->> 'sub'
    )
  );

-- Index supporting the predicate. The User.clerkId column is already
-- unique (see auth migration) so the join is constant-time; the
-- "spaceId" filter is the actual cost. Each subscribing client touches
-- this every event, so the index pays for itself within hours.
CREATE INDEX IF NOT EXISTS idx_space_owner_clerk
  ON "Space" ("ownerId");

-- Belt: keep anon completely shut out. The new policies above only
-- grant SELECT to `authenticated`; anon has no matching policy and
-- RLS denies by default. This explicit revoke makes the intent clear
-- and survives any future ALL-role permissiveness someone might
-- accidentally introduce.
REVOKE SELECT ON "Contact", "Deal", "DealStage", "Tour" FROM anon;
