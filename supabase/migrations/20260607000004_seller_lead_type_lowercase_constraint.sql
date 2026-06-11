-- Drop the leftover lowercase CHECK constraint that 20260409 added.
--
-- 20260409_add_check_constraints.sql added `contact_lead_type_check` (all
-- lowercase, no quotes) restricting `Contact."leadType"` to ('rental','buyer').
-- 20260604000001_seller_lead_type.sql tried to expand the allowed set to
-- include 'seller' but only dropped `Contact_leadType_check` (mixed-case,
-- the PostgreSQL-auto-named constraint from the ORIGINAL table DDL). On any
-- database where 20260409 had been applied the lowercase constraint was
-- still active, so every seller-lead insert from `create_contact` got
-- rejected with `new row violates check constraint`.
--
-- This migration drops the lowercase constraint and re-adds the seller-
-- inclusive one. Idempotent: safe to apply against a DB that has either
-- (or neither) of the prior constraints in place.

ALTER TABLE "Contact"
  DROP CONSTRAINT IF EXISTS contact_lead_type_check;

ALTER TABLE "Contact"
  DROP CONSTRAINT IF EXISTS "Contact_leadType_check";

ALTER TABLE "Contact"
  ADD CONSTRAINT contact_lead_type_check
  CHECK ("leadType" IN ('rental', 'buyer', 'seller'));
