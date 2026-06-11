-- ============================================================================
-- RLS SELECT policies for the integration tables.
--
-- HONEST SCOPE NOTE (read before assuming this is load-bearing):
-- This app reaches these three tables ONLY via the Supabase service-role key
-- (lib/supabase.ts), which BYPASSES RLS entirely. The only non-service-role
-- path in the system is the browser Realtime client (anon -> authenticated via
-- the Clerk "supabase" JWT template), and it subscribes ONLY to
-- Contact/Deal/DealStage/Tour (policied in 20260607000011). None of the
-- integration tables is read by the browser client.
--
-- So these policies are DEFENSE-IN-DEPTH, not load-bearing for today's request
-- flow: they protect against (a) the anon/authenticated key being pointed
-- straight at PostgREST, (b) a future code path accidentally using the browser
-- client on these tables, and (c) least-privilege posture. They buy zero
-- security for the current server flow (service-role ignores them) and they
-- cannot break it (service-role ignores them).
--
-- Pattern mirrors 20260607000011_realtime_authenticated_rls.sql exactly:
-- TO authenticated, scoped by auth.jwt()->>'sub' (the Clerk userId) joined to
-- User.clerkId. SELECT-only; writes stay service-role (RLS denies writes to
-- authenticated by default since no write policy exists). Idempotent.
-- ============================================================================

-- ── IntegrationConnection — scope by space ownership ────────────────────────
DROP POLICY IF EXISTS "integration_connection_authenticated_select" ON "IntegrationConnection";
CREATE POLICY "integration_connection_authenticated_select" ON "IntegrationConnection"
  FOR SELECT TO authenticated
  USING (
    "spaceId" IN (
      SELECT s.id FROM "Space" s
      JOIN "User" u ON u.id = s."ownerId"
      WHERE u."clerkId" = auth.jwt() ->> 'sub'
    )
  );
REVOKE ALL ON "IntegrationConnection" FROM anon, authenticated;
GRANT SELECT ON "IntegrationConnection" TO authenticated;

-- ── IntegrationTrigger — no spaceId; reach it through its connectionId FK ────
DROP POLICY IF EXISTS "integration_trigger_authenticated_select" ON "IntegrationTrigger";
CREATE POLICY "integration_trigger_authenticated_select" ON "IntegrationTrigger"
  FOR SELECT TO authenticated
  USING (
    "connectionId" IN (
      SELECT ic.id FROM "IntegrationConnection" ic
      JOIN "Space" s ON s.id = ic."spaceId"
      JOIN "User" u ON u.id = s."ownerId"
      WHERE u."clerkId" = auth.jwt() ->> 'sub'
    )
  );
REVOKE ALL ON "IntegrationTrigger" FROM anon, authenticated;
GRANT SELECT ON "IntegrationTrigger" TO authenticated;

-- ── BrokerageIntegrationConnection — scope by broker-level membership ───────
-- BrokerageMembership.userId is the INTERNAL User.id (REFERENCES "User"(id)),
-- and roles are 'broker_owner' | 'broker_admin' | 'realtor_member'. Only
-- owners/admins manage brokerage integrations, so restrict to those two.
DROP POLICY IF EXISTS "brokerage_integration_connection_authenticated_select" ON "BrokerageIntegrationConnection";
CREATE POLICY "brokerage_integration_connection_authenticated_select"
  ON "BrokerageIntegrationConnection"
  FOR SELECT TO authenticated
  USING (
    "brokerageId" IN (
      SELECT m."brokerageId" FROM "BrokerageMembership" m
      JOIN "User" u ON u.id = m."userId"
      WHERE u."clerkId" = auth.jwt() ->> 'sub'
        AND m."role" IN ('broker_owner', 'broker_admin')
    )
  );
REVOKE ALL ON "BrokerageIntegrationConnection" FROM anon, authenticated;
GRANT SELECT ON "BrokerageIntegrationConnection" TO authenticated;
