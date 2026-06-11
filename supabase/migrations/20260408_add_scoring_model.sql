-- Add AI-generated scoring model columns to SpaceSetting and Team
-- These store the scoring models separately from the form configs

-- Space-level scoring models (per agent)
ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "rentalScoringModel" jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "buyerScoringModel" jsonb DEFAULT NULL;

-- Team-level scoring models (inherited by members)
ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "teamRentalScoringModel" jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "teamBuyerScoringModel" jsonb DEFAULT NULL;

COMMENT ON COLUMN "SpaceSetting"."rentalScoringModel" IS 'AI-generated scoring model for rental intake form. JSON matches ScoringModel type.';
COMMENT ON COLUMN "SpaceSetting"."buyerScoringModel" IS 'AI-generated scoring model for buyer intake form. JSON matches ScoringModel type.';
COMMENT ON COLUMN "Team"."teamRentalScoringModel" IS 'Team-wide default scoring model for rental forms.';
COMMENT ON COLUMN "Team"."teamBuyerScoringModel" IS 'Team-wide default scoring model for buyer forms.';
