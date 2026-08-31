-- Down-migration for 0220_hr_attendance.sql.
-- Example artifact for the "Rollback Readiness" gap-closure -- see
-- docs/ROLLBACK_RUNBOOK.md for the convention this establishes and when to
-- use it (this is NOT auto-applied by any script; a human/agent runs it
-- deliberately as part of a rollback decision, same as the runbook's
-- other steps).
--
-- IMPORTANT, read before running: this reverses everything 0220 itself
-- ADDED (hr_attendance_records, hr_holidays, their RLS policies/grants/
-- indexes, and the module_registry/asset_registration_config rows it
-- inserted). It deliberately does NOT attempt to recreate
-- compliance.hr_timesheet_entries / compliance.hr_attendance / the
-- hr_timesheet_approval_status enum that 0220 dropped -- 0220's own header
-- comment documents those as confirmed dead, orphaned, zero-row,
-- zero-code-reference tables from an abandoned session that reached the
-- live DB directly with no git trace. Recreating empty orphan tables on
-- rollback would not restore anything real; it would just reintroduce the
-- same orphan this migration correctly cleaned up. If real
-- hr_attendance_records/hr_holidays data exists when this runs, it is
-- destroyed by the DROP TABLE below -- this is a genuinely destructive
-- rollback, appropriate only if the HR Attendance feature has no real
-- production usage yet. Back up those two tables first if in doubt:
--   `\copy compliance.hr_attendance_records to '/tmp/hr_attendance_records_backup.csv' csv header`
--   `\copy compliance.hr_holidays to '/tmp/hr_holidays_backup.csv' csv header`

BEGIN;

DELETE FROM compliance.asset_registration_config WHERE source_table = 'hr_holidays';
DELETE FROM compliance.module_registry WHERE module_key IN ('hr_attendance_records', 'hr_holidays');

DROP TABLE IF EXISTS compliance.hr_attendance_records;
DROP TABLE IF EXISTS compliance.hr_holidays;

-- hr_attendance_status is intentionally NOT dropped -- 0220's own comment
-- notes it was reused from the pre-existing (abandoned-session) enum
-- rather than created fresh, and nothing else in this down-migration can
-- safely determine whether some other object still depends on it.

COMMIT;
