-- Down-migration for drizzle/0627_build001_awl_retention.sql (PROJEXA-BUILD-001 U-46 step 1). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the database as it was before 0627. The cron job ai-work-link-call-retention is unscheduled (when the cron
--   schema exists and the job is there) and public.ai_work_link_call_retention(integer) is dropped.
--
-- ORDER: run it before the down file of 0623 (the function calls the partition helper that file creates).
--
-- DATA LOSS: none from this file. It does NOT restore the partitions the job already dropped: those rows are gone by the 90-day
--   design. With the job gone, no partition is created ahead any more: the log keeps working on the partitions that exist (the
--   current month and the next two, made by 0623 and by the last run), and then fails closed with 503 once the last of them ends.
--   Roll the rest of the link back, or put the job back, before that happens.
--
-- WHEN IT REFUSES: it does not. Safe to run twice: every step checks for its own object first.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
DECLARE
  v_scheduled boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''ai-work-link-call-retention'')' INTO v_scheduled;
    IF v_scheduled THEN
      EXECUTE 'SELECT cron.unschedule(''ai-work-link-call-retention'')';
    END IF;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.ai_work_link_call_retention(integer);

COMMIT;
