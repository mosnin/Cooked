-- Composio trigger subscriptions per realtor connection.
--
-- Each row tracks ONE registered Composio trigger for ONE
-- IntegrationConnection. When a realtor connects Gmail we register the
-- curated triggers for the gmail toolkit (see lib/integrations/triggers.ts)
-- and store the Composio-side trigger ids here. On disconnect we delete
-- the subscriptions at Composio AND the rows here.
--
-- Why a separate table from IntegrationConnection: a connection can have
-- 0..N triggers, and we want to enable/disable individual triggers
-- without touching the connection itself. ON DELETE CASCADE on the
-- connection FK means a hard-delete of the connection automatically
-- cleans this up too — but the normal disconnect path also deletes at
-- Composio's side before the row goes (see connections.ts revoke).
--
-- status:
--   active  — registered at Composio, webhook deliveries dispatch
--   paused  — registered at Composio but receiver drops deliveries
--   failed  — registration attempted but Composio rejected it; row
--             kept as a breadcrumb so the realtor isn't silently missing
--             functionality the catalog implies they get

CREATE TABLE IF NOT EXISTS "IntegrationTrigger" (
  "id"                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "connectionId"        TEXT NOT NULL REFERENCES "IntegrationConnection"(id) ON DELETE CASCADE,
  "composioTriggerId"   TEXT,                            -- nullable while status='failed' (registration never succeeded)
  "triggerSlug"         TEXT NOT NULL,                   -- e.g. 'GMAIL_NEW_GMAIL_MESSAGE'
  "status"              TEXT NOT NULL DEFAULT 'active'
                          CHECK ("status" IN ('active', 'paused', 'failed')),
  "lastFiredAt"         TIMESTAMPTZ,
  "lastError"           TEXT,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (connection, triggerSlug). A re-register UPSERTs into the
-- same row instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationTrigger_connection_slug_unique"
  ON "IntegrationTrigger" ("connectionId", "triggerSlug");

-- Hot path: the webhook receiver joins on composioTriggerId to find the
-- IntegrationTrigger row from an incoming delivery. Partial index skips
-- the rare null (failed) rows.
CREATE INDEX IF NOT EXISTS "IntegrationTrigger_composioTriggerId_idx"
  ON "IntegrationTrigger" ("composioTriggerId")
  WHERE "composioTriggerId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IntegrationTrigger_connectionId_idx"
  ON "IntegrationTrigger" ("connectionId");

ALTER TABLE "IntegrationTrigger" ENABLE ROW LEVEL SECURITY;
