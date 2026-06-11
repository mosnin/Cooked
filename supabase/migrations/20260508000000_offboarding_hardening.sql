-- ============================================================================
-- Team offboarding hardening (follow-up to 20260506000000)
-- ============================================================================
-- Audit of BP1 found two SECURITY items:
--
--   1. GRANT EXECUTE ... TO authenticated meant any Clerk-authed user talking
--      to Supabase via the anon key + a JWT could invoke the RPC directly,
--      bypassing the API-level role check. Only server-side code (which
--      uses SUPABASE_SERVICE_ROLE_KEY) ever needs to call this function;
--      the API route is the single entry point. Revoking the authenticated
--      grant closes the bypass.
--
--   2. The function trusted its callers to have pre-verified that the
--      destination user is still 'active'. Defense-in-depth: check inside
--      the function too, so a direct service_role call (e.g. a future
--      background job) can't accidentally transfer data to an offboarded
--      user.
-- ============================================================================

-- 1. Tighten grant.
REVOKE EXECUTE ON FUNCTION offboard_team_member(text, text, text, boolean)
  FROM authenticated;

-- 2. Replace the function body with one that also guards the destination's
-- status. CREATE OR REPLACE preserves the existing signature/grants on
-- service_role; we just swap the definition. Everything else about the
-- function (locking, transfer scope, return shape) is unchanged — copy the
-- body verbatim from the original migration and add the destination check
-- near the top alongside the existing Space lookups.
CREATE OR REPLACE FUNCTION offboard_team_member(
  p_leaving_user_id     text,
  p_destination_user_id text,
  p_team_id        text,
  p_dry_run             boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leaving_space_id     text;
  v_destination_space_id text;
  v_destination_status   text;
  v_contact_count        integer := 0;
  v_deal_count           integer := 0;
  v_demo_count           integer := 0;
BEGIN
  -- Destination must still be 'active' — we accept the column not existing
  -- on pre-migration databases by treating NULL as active for forward-compat.
  SELECT COALESCE(status, 'active')
    INTO v_destination_status
    FROM "User"
   WHERE id = p_destination_user_id;
  IF v_destination_status IS NULL THEN
    RAISE EXCEPTION 'Destination user % not found', p_destination_user_id;
  END IF;
  IF v_destination_status <> 'active' THEN
    RAISE EXCEPTION 'Destination user % is not active (status=%)',
      p_destination_user_id, v_destination_status;
  END IF;

  -- Lock both spaces FOR UPDATE early so transfer counts match writes.
  SELECT id INTO v_leaving_space_id
    FROM "Space"
   WHERE "ownerId" = p_leaving_user_id
   FOR UPDATE;
  IF v_leaving_space_id IS NULL THEN
    RAISE EXCEPTION 'Leaving user % has no Space', p_leaving_user_id;
  END IF;

  SELECT id INTO v_destination_space_id
    FROM "Space"
   WHERE "ownerId" = p_destination_user_id
   FOR UPDATE;
  IF v_destination_space_id IS NULL THEN
    RAISE EXCEPTION 'Destination user % has no Space', p_destination_user_id;
  END IF;

  IF v_leaving_space_id = v_destination_space_id THEN
    RAISE EXCEPTION 'Leaving and destination resolve to the same Space';
  END IF;

  -- Stash the id sets for the transfer so count queries match the UPDATEs.
  CREATE TEMP TABLE IF NOT EXISTS _moved_contacts (id text PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _moved_deals    (id text PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _moved_contacts;
  TRUNCATE _moved_deals;

  INSERT INTO _moved_contacts (id)
  SELECT id FROM "Contact"
   WHERE "spaceId" = v_leaving_space_id
     AND "teamId" = p_team_id;

  INSERT INTO _moved_deals (id)
  SELECT d.id
    FROM "Deal" d
   WHERE d."spaceId" = v_leaving_space_id
     AND EXISTS (
       SELECT 1 FROM "DealContact" dc
       WHERE dc."dealId" = d.id
         AND dc."contactId" IN (SELECT id FROM _moved_contacts)
     );

  SELECT count(*) INTO v_contact_count FROM _moved_contacts;
  SELECT count(*) INTO v_deal_count    FROM _moved_deals;
  SELECT count(*) INTO v_demo_count
    FROM "Demo" t
   WHERE t."spaceId" = v_leaving_space_id
     AND t."contactId" IN (SELECT id FROM _moved_contacts)
     AND t."startsAt" >= now();

  IF p_dry_run THEN
    RETURN json_build_object(
      'dryRun', true,
      'contactCount', v_contact_count,
      'dealCount', v_deal_count,
      'openDemoCount', v_demo_count
    );
  END IF;

  -- Real-run transfer. Explicit spaceId filters added per audit NIT #5 —
  -- belt-and-suspenders over the transitive scoping through _moved_contacts
  -- / _moved_deals. Future refactors won't accidentally widen the scope.
  UPDATE "Contact"
     SET "spaceId" = v_destination_space_id
   WHERE id IN (SELECT id FROM _moved_contacts);

  UPDATE "ContactActivity"
     SET "spaceId" = v_destination_space_id
   WHERE "spaceId" = v_leaving_space_id
     AND "contactId" IN (SELECT id FROM _moved_contacts);

  UPDATE "Deal"
     SET "spaceId" = v_destination_space_id
   WHERE id IN (SELECT id FROM _moved_deals);

  UPDATE "DealActivity"
     SET "spaceId" = v_destination_space_id
   WHERE "spaceId" = v_leaving_space_id
     AND "dealId" IN (SELECT id FROM _moved_deals);

  UPDATE "DealChecklistItem"
     SET "spaceId" = v_destination_space_id
   WHERE "spaceId" = v_leaving_space_id
     AND "dealId" IN (SELECT id FROM _moved_deals);

  UPDATE "Demo"
     SET "spaceId" = v_destination_space_id
   WHERE "spaceId" = v_leaving_space_id
     AND "contactId" IN (SELECT id FROM _moved_contacts);

  DELETE FROM "TeamMembership"
   WHERE "userId" = p_leaving_user_id
     AND "teamId" = p_team_id;

  -- Only flip User.status to 'offboarded' if this was the user's LAST
  -- team membership. Dual-team reps (members of two
  -- teams at once) leaving one shouldn't be locked out of Koala
  -- entirely — the API gate in lib/api-auth.ts treats 'offboarded' as
  -- a hard account stop. We still record offboardedAt + offboardedToUserId
  -- so the audit trail for THIS transfer survives, but leave status active
  -- so their other team's membership keeps working.
  IF NOT EXISTS (
    SELECT 1 FROM "TeamMembership" WHERE "userId" = p_leaving_user_id
  ) THEN
    UPDATE "User"
       SET status = 'offboarded',
           "offboardedAt" = now(),
           "offboardedToUserId" = p_destination_user_id
     WHERE id = p_leaving_user_id;
  ELSE
    UPDATE "User"
       SET "offboardedAt" = now(),
           "offboardedToUserId" = p_destination_user_id
     WHERE id = p_leaving_user_id;
  END IF;

  RETURN json_build_object(
    'dryRun', false,
    'contactsMoved', v_contact_count,
    'dealsMoved', v_deal_count,
    'demosMoved', v_demo_count
  );
END;
$$;

-- Re-grant to service_role only — authenticated is deliberately excluded.
GRANT EXECUTE ON FUNCTION offboard_team_member(text, text, text, boolean)
  TO service_role;
