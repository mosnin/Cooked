-- E-signature requests — a realtor sends a stored document out for signature
-- via DocuSign. One row tracks one envelope from creation through completion.
--
-- envelopeId is the DocuSign handle; it's nullable because a row can exist
-- before DocuSign accepts the envelope (or when the integration is not
-- configured and the send no-ops). dealId / documentId are soft links back to
-- the source document — nullable so a request survives the document being
-- removed. signedDocumentUrl holds the storage path of the completed PDF,
-- written by the Connect webhook on envelope-completed.
--
-- RLS is enabled with no policies — every read/write goes through the server
-- with the service-role key (same posture as SupportTicket and DealDocument),
-- so the table is closed to anon/auth roles by default.

CREATE TABLE IF NOT EXISTS "SignatureRequest" (
  "id"                TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "spaceId"           TEXT        NOT NULL,
  "dealId"            TEXT,
  "documentId"        TEXT,
  "envelopeId"        TEXT,
  "subject"           TEXT        NOT NULL,
  "signerEmail"       TEXT        NOT NULL,
  "signerName"        TEXT,
  "status"            TEXT        NOT NULL DEFAULT 'created'
    CHECK ("status" IN ('created','sent','delivered','completed','declined','voided')),
  "signedDocumentUrl" TEXT,
  "completedAt"       TIMESTAMPTZ,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SignatureRequest_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE
);

-- The Signatures surface lists a space's requests newest-first.
CREATE INDEX IF NOT EXISTS "SignatureRequest_spaceId_createdAt_idx"
  ON "SignatureRequest" ("spaceId", "createdAt" DESC);

-- The Connect webhook resolves a request by its DocuSign envelope id.
CREATE INDEX IF NOT EXISTS "SignatureRequest_envelopeId_idx"
  ON "SignatureRequest" ("envelopeId");

-- Per-deal lookups (show signature status on a deal).
CREATE INDEX IF NOT EXISTS "SignatureRequest_dealId_idx"
  ON "SignatureRequest" ("dealId");

ALTER TABLE "SignatureRequest" ENABLE ROW LEVEL SECURITY;
