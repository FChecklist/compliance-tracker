-- Down-migration for drizzle/0619_build001_audit_surface.sql
-- (PROJEXA-BUILD-001 U-32 part A). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it
-- deliberately, after the same always-aborted rehearsal as the forward file
-- (runbook section 4a).
--
-- WHAT IT RESTORES: the exact pre-0619 schema of compliance.audit_logs
--   (18 columns): the check audit_logs_surface_check is dropped, then the
--   column surface.
--
-- DATA LOSS, read before running:
--   1. Every value in audit_logs.surface is lost, for every row: which of the
--      four surfaces each audit row was written from. Copy them out first if
--      they are wanted (select id, surface from compliance.audit_logs where
--      surface is not null). The register rows that read the column (BR-410,
--      BR-415, BR-417) fail from then on.
--   2. Nothing else: no row is deleted and no other column is touched.
--
-- SEQUENCING: roll back the code first (runbook section 4, step 3). A build
--   whose src/lib/db/schema.ts declares audit_logs.surface names the column in
--   every audit insert, so once this file has run that build fails every
--   write that records an audit row.
--
-- WHEN IT REFUSES: it does not.
--
-- Safe to run twice: DROP CONSTRAINT IF EXISTS and DROP COLUMN IF EXISTS.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE compliance.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_surface_check;

ALTER TABLE compliance.audit_logs
  DROP COLUMN IF EXISTS surface;

COMMIT;
