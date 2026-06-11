-- Speed-to-lead SLA enforcement.
--
-- Makes lead routing agentic: once a lead is routed to a rep, Koala holds
-- the rep (and the manager) to a first-response clock. These three columns
-- are the per-team policy the enforcement sweep reads
-- (`lib/manager-sla.ts`, run by `/api/cron/lead-sla`):
--
--   * "slaEnabled"               — off by default; the manager turns it on.
--   * "slaFirstResponseMinutes"  — how long a routed lead may sit un-worked
--                                   before Koala nudges the assigned rep.
--   * "slaEscalateMinutes"       — how long before Koala escalates the
--                                   still-untouched lead to the manager.
--
-- Additive + idempotent: no existing column touched. Detection needs no new
-- schema — a routed lead is the `assigned-by-manager`-tagged Contact clone in
-- the rep's space; "un-worked" = lastContactedAt IS NULL; the clock starts
-- at the clone's createdAt (assignment time).

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "slaEnabled"              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "slaFirstResponseMinutes" integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "slaEscalateMinutes"      integer NOT NULL DEFAULT 120;
