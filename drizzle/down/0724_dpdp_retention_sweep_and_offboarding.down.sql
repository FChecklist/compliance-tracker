-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 3 roll-back
-- Removes the daily job, the functions and the three tables. Data already deleted by a live sweep is not restored (there is no such data in a dry-run).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('dpdp-retention-sweep');
  end if;
exception when others then null;
end
$$;
drop function if exists public.dpdp_operator_offboard_export(text);
drop function if exists public.dpdp_operator_offboard_start(text);
drop function if exists public.dpdp__offboard_delete(text, boolean);
drop function if exists public.dpdp_timer_retention_sweep(boolean);
drop function if exists dpdp.retention_kept_tables();
drop table if exists dpdp.org_offboarding;
drop table if exists dpdp.retention_run;
drop table if exists dpdp.retention_setting;
