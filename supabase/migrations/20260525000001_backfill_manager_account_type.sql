-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: User.accountType for users who signed up as managers but are
-- still marked 'rep' in the DB.
--
-- Cause: before commit e27a6a6, the quick-path onboarding (OnboardingRep)
-- offered a "Team owner" role but its finish handler unconditionally
-- posted `accountType: 'rep'` to /api/onboarding/complete and routed
-- the user to /s/{slug}/koala. No Team row was ever created, so the
-- DB tells a contradictory story: AIUserProfile.role = 'team_owner'
-- but User.accountType = 'rep'.
--
-- This migration corrects the User row. It does NOT create a Team —
-- those users still need to visit /team and create their team
-- (which the manager/create endpoint now supports for accountType='both'
-- rep-upgraders).
--
-- After this runs, `/auth/redirect` will continue to send those users to
-- /s/{slug} (because they have no TeamMembership yet), and the
-- /team page will be open to them as the self-serve upgrade path.
-- ═══════════════════════════════════════════════════════════════════════════

-- AIUserProfile is keyed on spaceId (one row per Space, not per User), so
-- bridge through Space.ownerId to reach the User.
--
-- Defensive wrapper: `AIUserProfile.role` is added by an earlier migration
-- (20260514000001_rep_onboarding_profile.sql). On databases that
-- haven't run that one yet, the column doesn't exist and a bare query
-- against `p.role` errors with 42703. Guard with information_schema so
-- this migration is safe to run on any schema state — if the role column
-- isn't there, pass 1 has nothing to backfill anyway and silently skips.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AIUserProfile'
      AND column_name = 'role'
  ) THEN
    UPDATE "User" u
    SET "accountType" = 'both'
    WHERE u."accountType" = 'rep'
      AND EXISTS (
        SELECT 1
        FROM "Space" s
        JOIN "AIUserProfile" p ON p."spaceId" = s.id
        WHERE s."ownerId" = u.id
          AND p.role = 'team_owner'
      );
  END IF;
END $$;

-- Also catch the inverse: users who ALREADY own a Team but whose
-- User row never had accountType updated (covers race conditions or
-- manual data inserts). manager_only and 'both' are both correct for
-- manager_owners depending on whether they have a personal workspace —
-- pick 'both' when a Space exists, 'manager_only' otherwise.

UPDATE "User" u
SET "accountType" = CASE
  WHEN EXISTS (SELECT 1 FROM "Space" s WHERE s."ownerId" = u.id) THEN 'both'
  ELSE 'manager_only'
END
FROM "Team" b
WHERE b."ownerId" = u.id
  AND (u."accountType" = 'rep' OR u."accountType" IS NULL);
