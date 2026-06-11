-- Native (non-Composio) integrations need somewhere to keep their own
-- credential. Composio holds OAuth tokens for the toolkits it supports, but
-- some CRMs — Follow Up Boss is the first — authenticate with a user-issued
-- API key over HTTP Basic, with no OAuth dance and no Composio toolkit.
--
-- For those, the realtor pastes their API key once; we encrypt it at rest
-- (AES-256-GCM via lib/crypto.ts, same as the Google Calendar token) and
-- store the ciphertext here. The row's composioConnectionId carries a
-- 'native:<toolkit>' sentinel so the unique-active index keeps working and
-- nothing tries to resolve it against Composio.
--
-- Nullable: every existing Composio-backed row leaves this NULL.

ALTER TABLE "IntegrationConnection"
  ADD COLUMN IF NOT EXISTS "secretCiphertext" TEXT;
