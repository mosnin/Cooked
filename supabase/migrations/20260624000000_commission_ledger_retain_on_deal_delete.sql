-- ============================================================================
-- CommissionLedger: retain the brokerage's commission books when a Deal is
-- deleted. (Audit data-integrity finding — sibling of #311 which did the same
-- for agentUserId.)
--
-- THE BUG: CommissionLedger.dealId was `NOT NULL REFERENCES "Deal"(id)
-- ON DELETE CASCADE` (20260507000000_commission_ledger.sql:60). Deleting a Deal
-- — a normal operational action (deals get removed, merged, cleaned up) —
-- CASCADE-deleted its commission/payout ledger row, destroying a financial
-- record the brokerage owns and may need for payout reconciliation, disputes,
-- and audit. A money ledger must outlive the operational rows it references.
--
-- FIX: make dealId nullable and switch the FK to ON DELETE SET NULL, mirroring
-- the agentUserId fix in 20260619000000. A deleted deal's ledger row survives
-- with dealId = NULL; the brokerage's books stay intact. brokerageId keeps
-- ON DELETE CASCADE — deleting the whole brokerage tenant still clears its
-- ledger, which is correct tenant teardown.
--
-- Compatibility:
--   * UNIQUE("dealId") still prevents two ledger rows for the same live deal
--     (NULLs are distinct in a unique index, so multiple retained NULL rows are
--     fine). New inserts always carry a non-null dealId, so the
--     ON CONFLICT ("dealId") DO NOTHING idempotency path is unaffected.
--   * Readers of dealId must tolerate NULL (historical rows for deleted deals).
--
-- ✓ VALIDATED on PostgreSQL 16: the constraint swap applies clean; deleting a
--   Deal now PRESERVES the commission row with dealId = NULL (before: the row
--   was cascade-deleted). FK name is the Postgres default
--   "CommissionLedger_dealId_fkey"; the DROP is guarded with IF EXISTS.
-- ============================================================================

ALTER TABLE "CommissionLedger" ALTER COLUMN "dealId" DROP NOT NULL;

ALTER TABLE "CommissionLedger" DROP CONSTRAINT IF EXISTS "CommissionLedger_dealId_fkey";

ALTER TABLE "CommissionLedger"
  ADD CONSTRAINT "CommissionLedger_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON DELETE SET NULL;
