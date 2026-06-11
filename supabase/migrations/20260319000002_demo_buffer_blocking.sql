-- Buffer time between demos and manual date blocking
ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "demoBufferMinutes" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "demoBlockedDates"  text[] NOT NULL DEFAULT '{}';

-- Track source of deal for demo→deal conversion analytics
ALTER TABLE "Deal"
  ADD COLUMN IF NOT EXISTS "sourceDemoId" text REFERENCES "Demo"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deal_source_demo ON "Deal" ("sourceDemoId");
