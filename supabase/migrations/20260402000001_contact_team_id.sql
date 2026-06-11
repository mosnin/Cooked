-- Add teamId to Contact so team intake leads are queryable by team
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "teamId" text REFERENCES "Team"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contact_team ON "Contact"("teamId");
