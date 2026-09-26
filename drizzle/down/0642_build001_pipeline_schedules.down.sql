-- Down-migration for drizzle/0642_build001_pipeline_schedules.sql (PROJEXA-BUILD-001 U-40). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file (do-block generated with --schemas compliance,public).
--
-- WHAT IT RESTORES: the database as it was before 0642. The cron job projexa-scheduler-bridge is unscheduled (whether or not it
--   was switched on), the two functions public.projexa_scheduler_bridge_check_bearer and public.projexa_scheduler_bridge_due_count
--   are dropped, and the table compliance.pipeline_schedules is dropped with its constraints, indexes, policies and grants.
--
-- DATA LOSS, read before running: every schedule row is lost, including each schedule's owner, function, parameters, cadence and
--   last result. Copy them out first if they are wanted (select * from compliance.pipeline_schedules). Proposals the bridge already
--   stored are ordinary compliance.submissions rows and stay; audit rows stay. It does NOT delete the two Vault secrets
--   projexa_scheduler_bridge_url and projexa_scheduler_bridge_secret (created outside the migration; drop them with
--   vault.delete_secret only when the bridge is retired for good), and it does not undeploy the Edge Function
--   projexa-scheduler-bridge: with the bearer function gone the function refuses every call, so undeploy it separately. Switch the
--   cron job off (or roll this file back) before removing the app route, otherwise the job keeps calling the Edge Function.
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
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''projexa-scheduler-bridge'')' INTO v_scheduled;
    IF v_scheduled THEN
      EXECUTE 'SELECT cron.unschedule(''projexa-scheduler-bridge'')';
    END IF;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.projexa_scheduler_bridge_due_count();
DROP FUNCTION IF EXISTS public.projexa_scheduler_bridge_check_bearer(text);
DROP TABLE IF EXISTS compliance.pipeline_schedules;

COMMIT;
