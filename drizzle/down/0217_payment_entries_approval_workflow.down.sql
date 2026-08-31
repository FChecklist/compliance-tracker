-- Down-migration for 0217_payment_entries_approval_workflow.sql.
-- Example artifact for the "Rollback Readiness" gap-closure -- see
-- docs/ROLLBACK_RUNBOOK.md for the convention this establishes and when to
-- use it (this is NOT auto-applied by any script; a human/agent runs it
-- deliberately as part of a rollback decision, same as the runbook's
-- other steps).
--
-- IMPORTANT, read before running: 0217 widened erp_payment_entries.status
-- from compliance.erp_journal_entry_status ('draft'|'submitted'|
-- 'cancelled') to the new compliance.erp_payment_entry_status ('draft'|
-- 'submitted'|'approved'|'rejected'|'cancelled'). If any row's status is
-- now 'approved' or 'rejected' (i.e. the approval workflow this migration
-- enabled has real usage), the cast back to the old 3-value enum below
-- WILL FAIL -- those two values don't exist in the old type and there is
-- no lossless mapping (defaulting them to e.g. 'submitted' would silently
-- discard the approval decision). That failure is intentional: it forces a
-- real data decision (migrate those rows' status by hand, or accept the
-- data loss explicitly) rather than this script guessing silently. If the
-- feature has zero real usage yet (check: `select count(*) from
-- compliance.erp_payment_entries where status in ('approved','rejected')`
-- returns 0), this runs cleanly.

BEGIN;

ALTER TABLE "compliance"."erp_payment_entries"
  DROP COLUMN IF EXISTS "invoice_type",
  DROP COLUMN IF EXISTS "invoice_id",
  DROP COLUMN IF EXISTS "created_by_id",
  DROP COLUMN IF EXISTS "submitted_by_id",
  DROP COLUMN IF EXISTS "submitted_at",
  DROP COLUMN IF EXISTS "decided_by_id",
  DROP COLUMN IF EXISTS "decided_at",
  DROP COLUMN IF EXISTS "decision_comment";

ALTER TABLE "compliance"."erp_payment_entries"
  ALTER COLUMN "status" DROP DEFAULT;

-- Will raise "invalid input value for enum erp_journal_entry_status" if any
-- row holds 'approved' or 'rejected' -- see header comment above.
ALTER TABLE "compliance"."erp_payment_entries"
  ALTER COLUMN "status" TYPE "compliance"."erp_journal_entry_status"
  USING "status"::text::"compliance"."erp_journal_entry_status";

ALTER TABLE "compliance"."erp_payment_entries"
  ALTER COLUMN "status" SET DEFAULT 'draft';

DROP TYPE IF EXISTS "compliance"."erp_payment_entry_status";

COMMIT;
