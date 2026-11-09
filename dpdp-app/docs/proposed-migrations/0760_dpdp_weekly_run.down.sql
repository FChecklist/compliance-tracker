-- Rollback of 0760: removes the weekly-routine record. The page falls back to reading History, so nothing else depends on it.
-- DATA LOSS: every row in dpdp.weekly_run is dropped (a person's sign-off also lives on in History as a 'weekly_run_logged' event, which is NOT touched).
-- Re-runnable: IF EXISTS everywhere.
BEGIN;
drop function if exists public.dpdp_weekly_runs(text, integer);
drop function if exists public.dpdp_weekly_log(text, text, text, text, text);
drop table if exists dpdp.weekly_run;
COMMIT;
