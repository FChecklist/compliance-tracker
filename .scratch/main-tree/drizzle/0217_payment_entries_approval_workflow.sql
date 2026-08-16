-- Wave B (VERIDIAN Review Framework remediation): Payment Entries approval
-- flow, explicitly WITHOUT a live payment gateway connection (Owner
-- directive 2026-07-16 -- Razorpay credentials stay held back, this is
-- approval/record-keeping only).
--
-- erp_payment_entries has existed since Wave 49 with zero service-layer
-- consumer anywhere in this codebase (confirmed via repo-wide grep before
-- writing this migration) -- so widening its own status enum and adding
-- columns here has no real caller/data to break.
--
-- 1) A dedicated status enum (draft/submitted/approved/rejected/cancelled),
--    replacing the borrowed erp_journal_entry_status (draft/submitted/
--    cancelled -- no approval concept) that erp_journal_entries itself
--    keeps using unchanged. The new enum is a superset of the old one's
--    values, so the USING cast below is safe even if a row already exists.
-- 2) Polymorphic invoice link (invoice_type/invoice_id), mirroring
--    erp_journal_entries.reference_type/reference_id's existing
--    convention, so a payment can be applied against a sales or purchase
--    invoice.
-- 3) Workflow actor/timestamp columns for the approval decision itself
--    (created_by_id was previously entirely missing from this table).

CREATE TYPE "compliance"."erp_payment_entry_status" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'cancelled');

ALTER TABLE "compliance"."erp_payment_entries"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "compliance"."erp_payment_entries"
  ALTER COLUMN "status" TYPE "compliance"."erp_payment_entry_status"
  USING "status"::text::"compliance"."erp_payment_entry_status";

ALTER TABLE "compliance"."erp_payment_entries"
  ALTER COLUMN "status" SET DEFAULT 'draft';

ALTER TABLE "compliance"."erp_payment_entries"
  ADD COLUMN IF NOT EXISTS "invoice_type" text,
  ADD COLUMN IF NOT EXISTS "invoice_id" text,
  ADD COLUMN IF NOT EXISTS "created_by_id" text,
  ADD COLUMN IF NOT EXISTS "submitted_by_id" text,
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "decided_by_id" text,
  ADD COLUMN IF NOT EXISTS "decided_at" timestamp,
  ADD COLUMN IF NOT EXISTS "decision_comment" text;
