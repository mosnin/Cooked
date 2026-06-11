-- Enable Row Level Security on tables that were created without it.
--
-- The Next.js server talks to Postgres with the Supabase SERVICE ROLE, which
-- bypasses RLS — so server reads/writes are unaffected by this migration. But
-- the public ANON key ships to the browser (lib/supabase-browser.ts) for
-- Realtime, and any table WITHOUT RLS is readable/writable by that anon role
-- through PostgREST. The tables below hold workspace/PII data (broker<->Chippi
-- chat bodies, uploaded-document text + URLs, broadcasts, affiliate accounts,
-- agent state) and had RLS never enabled.
--
-- Enabling RLS with NO policy denies every non-bypassing role (anon +
-- authenticated). That is the correct, safe default here: NONE of these tables
-- is read via the browser/anon client or subscribed via Supabase Realtime.
-- Realtime touches only Contact / Deal / DealStage / Tour, already scoped in
-- 20260607000011_realtime_authenticated_rls.sql (verified against the realtime
-- hooks + the two browser-client components). So deny-all closes the anon hole
-- without breaking any product surface. If one of these ever needs client-side
-- reads, add a scoped SELECT policy for `authenticated` in a follow-up — do not
-- weaken these back to open.
--
-- IF EXISTS keeps the migration safe to run against a partially-provisioned
-- database (a table that doesn't exist yet is skipped, not an error).
-- ENABLE ROW LEVEL SECURITY is idempotent — re-running is a no-op.

-- Sensitive content / PII
ALTER TABLE IF EXISTS "BrokerConversation"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "BrokerMessage"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Attachment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "EmailBroadcast"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AffiliateAccount"      ENABLE ROW LEVEL SECURITY;

-- Agent + workspace state
ALTER TABLE IF EXISTS "AgentSettings"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AgentGoal"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AgentQuestion"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AgentTrajectory"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Brief"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "BriefTipHistory"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Pipeline"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "Announcement"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "AnnouncementDismissal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "TelemetryEvent"        ENABLE ROW LEVEL SECURITY;
