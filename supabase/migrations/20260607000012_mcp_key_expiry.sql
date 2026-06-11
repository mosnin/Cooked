-- MCP API keys: add expiresAt + default-365-day TTL on new keys.
--
-- Before this migration, keys lived indefinitely until manually revoked.
-- A leak from a CI log, dev machine, or an exfiltrated devops backup
-- meant the attacker had read-only Composio-MCP access to the realtor's
-- workspace forever — no clock running out the credential. Wave 11 audit
-- flagged this as the highest-severity finding on the MCP surface.
--
-- Backwards compat:
--   * The column is nullable. Existing keys have NULL expiresAt, which the
--     verification path treats as "never expires" — no live integration
--     gets cut off when this lands.
--   * New keys default to 365-day TTL set by the issuing route. Long
--     enough that realtors who set-and-forget don't break their Claude
--     connector mid-year; short enough that a stale leak goes cold within
--     a calendar cycle.
--
-- A follow-up could:
--   * Add a UI affordance to set a custom TTL on creation (default 1y).
--   * Backfill expiresAt on existing keys with a long grace window
--     (e.g. now() + 1y) and notify realtors. Not done here — that's a
--     policy call, not a security gate.

ALTER TABLE "McpApiKey"
  ADD COLUMN IF NOT EXISTS "expiresAt" timestamptz;

-- Index supporting "expired keys" lookups for an eventual cron-driven
-- cleanup. Predicate index: only rows that actually have an expiresAt set
-- (i.e. new-style keys) need to be considered.
CREATE INDEX IF NOT EXISTS idx_mcp_api_key_expires
  ON "McpApiKey" ("expiresAt")
  WHERE "expiresAt" IS NOT NULL;
