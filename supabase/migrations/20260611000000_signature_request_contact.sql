-- A SignatureRequest can be tied to a Person (Contact), not just a Deal —
-- the realtor can send a document to a specific person from their record.
-- contactId is a soft link (nullable, no FK) so a request survives the
-- contact being removed, mirroring the dealId/documentId posture on this table.

ALTER TABLE "SignatureRequest" ADD COLUMN IF NOT EXISTS "contactId" TEXT;

-- Per-person lookups (show signature status on a person's record).
CREATE INDEX IF NOT EXISTS "SignatureRequest_contactId_createdAt_idx"
  ON "SignatureRequest" ("contactId", "createdAt" DESC);
