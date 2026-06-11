-- Speed-to-lead SLA enforcement.
--
-- Makes lead routing agentic: once a lead is routed to a realtor, Chippi holds
-- the realtor (and the broker) to a first-response clock. These three columns
-- are the per-brokerage policy the enforcement sweep reads
-- (`lib/broker-sla.ts`, run by `/api/cron/lead-sla`):
--
--   * "slaEnabled"               — off by default; the broker turns it on.
--   * "slaFirstResponseMinutes"  — how long a routed lead may sit un-worked
--                                   before Chippi nudges the assigned realtor.
--   * "slaEscalateMinutes"       — how long before Chippi escalates the
--                                   still-untouched lead to the broker.
--
-- Additive + idempotent: no existing column touched. Detection needs no new
-- schema — a routed lead is the `assigned-by-broker`-tagged Contact clone in
-- the realtor's space; "un-worked" = lastContactedAt IS NULL; the clock starts
-- at the clone's createdAt (assignment time).

ALTER TABLE "Brokerage"
  ADD COLUMN IF NOT EXISTS "slaEnabled"              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "slaFirstResponseMinutes" integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "slaEscalateMinutes"      integer NOT NULL DEFAULT 120;
