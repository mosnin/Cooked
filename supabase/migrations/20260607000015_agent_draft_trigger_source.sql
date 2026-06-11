-- AgentDraft.triggerSource — provenance for drafts that originated from
-- an inbound event (Composio trigger fired, calendar accept, etc.)
-- rather than the realtor's own chat turn or a scheduled routine.
--
-- Shape we write today (the column is JSONB so future kinds layer on
-- top without a schema change):
--
--   { kind: 'composio_trigger',
--     slug: 'GMAIL_NEW_GMAIL_MESSAGE',
--     toolkit: 'gmail',
--     deliveryId: 'msg_xxx' }
--
-- NULL for any draft NOT triggered by an external event — keeping the
-- migration backwards-compatible. The UI uses presence as the gate for
-- rendering the "Chippi noticed because..." breadcrumb under the draft.

ALTER TABLE "AgentDraft"
  ADD COLUMN IF NOT EXISTS "triggerSource" JSONB;

-- No index — the column is read by primary-key lookup from
-- /api/agent/drafts, never filtered on. JSONB GIN indexing here would
-- be premature.
