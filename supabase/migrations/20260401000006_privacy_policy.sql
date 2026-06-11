-- Add privacyPolicyHtml column to SpaceSetting and Team tables
-- Stores rich-text (HTML) privacy policy content

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "privacyPolicyHtml" text;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "privacyPolicyHtml" text;
