-- Down-migration for drizzle/0634_build001_cron_the_firm_recur.sql (PROJEXA-BUILD-001 U-41 part B). Convention: docs/ROLLBACK_RUNBOOK.md section 3.
-- Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the database as it was before 0634 -- the cron job cost001-the-firm-recur-engagements is unscheduled and the
--   function compliance.cron_the_firm_recur_engagements is dropped.
--
-- DATA LOSS: none from this file. It does NOT revert what earlier runs of the job wrote (rows and dates a run wrote stay as ordinary data).
--
-- WHEN IT REFUSES: it does not.
--
-- Safe to run twice: every step checks for its own object first.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
DECLARE
  v_scheduled boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''cost001-the-firm-recur-engagements'')' INTO v_scheduled;
    IF v_scheduled THEN
      EXECUTE 'SELECT cron.unschedule(''cost001-the-firm-recur-engagements'')';
    END IF;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS compliance.cron_the_firm_recur_engagements(text, date);

COMMIT;
