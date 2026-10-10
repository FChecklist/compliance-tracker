-- Down-migration for drizzle/0615_build001_projexa_timer.sql (PROJEXA-BUILD-001 U-21, PMD-12). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the database as it was before 0615 -- the cron job projexa-exchange-rate-refresh is unscheduled and the three
--   functions public.projexa_timer_check_bearer, public.projexa_timer_exchange_plan and public.projexa_timer_apply_exchange_rates are
--   dropped.
--
-- DATA LOSS: none from this file. It does NOT delete the rates the job already wrote (compliance.erp_exchange_rates rows with
--   source = 'live' stay; they are ordinary data), and it does NOT delete the two Vault secrets projexa_timer_url and
--   projexa_timer_secret (created outside the migration; drop them with vault.delete_secret only when the PROJEXA timer is retired
--   for good). With the job gone the Edge Function projexa-timer, if still deployed, refuses every call (its bearer check no longer
--   exists), so undeploy it separately.
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
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''projexa-exchange-rate-refresh'')' INTO v_scheduled;
    IF v_scheduled THEN
      EXECUTE 'SELECT cron.unschedule(''projexa-exchange-rate-refresh'')';
    END IF;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.projexa_timer_apply_exchange_rates(text, date, jsonb);
DROP FUNCTION IF EXISTS public.projexa_timer_exchange_plan();
DROP FUNCTION IF EXISTS public.projexa_timer_check_bearer(text);

COMMIT;
