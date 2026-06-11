-- Rename manager_manager → manager_admin across team role system
-- This creates a clearer hierarchy: manager_owner > manager_admin > rep_member

-- 1. Update existing membership rows
UPDATE "TeamMembership"
SET role = 'manager_admin'
WHERE role = 'manager_manager';

-- 2. Update existing invitation rows
UPDATE "Invitation"
SET "roleToAssign" = 'manager_admin'
WHERE "roleToAssign" = 'manager_manager';

-- 3. Drop existing CHECK constraints by querying pg_constraint catalog
--    (constraint names are auto-generated and may vary across Postgres versions)
DO $$
DECLARE
  _con_name text;
BEGIN
  -- Drop all CHECK constraints on TeamMembership.role
  FOR _con_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'TeamMembership'
      AND att.attname = 'role'
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE "TeamMembership" DROP CONSTRAINT %I', _con_name);
  END LOOP;

  -- Drop all CHECK constraints on Invitation.roleToAssign
  FOR _con_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'Invitation'
      AND att.attname = 'roleToAssign'
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE "Invitation" DROP CONSTRAINT %I', _con_name);
  END LOOP;
END $$;

-- 4. Add new CHECK constraints with known names
ALTER TABLE "TeamMembership"
  ADD CONSTRAINT "TeamMembership_role_check"
  CHECK (role IN ('manager_owner', 'manager_admin', 'rep_member'));

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_roleToAssign_check"
  CHECK ("roleToAssign" IN ('manager_admin', 'rep_member'));
