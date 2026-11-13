-- Rollback of 0763 (DPDP ICP slice 3, the Monday e-mail block). Drops the function, its helper and the once-a-week index. Nothing else changes: the "Monday snapshot" rows it added to
-- dpdp.icp_run stay (that record is append-only by design, and they are the organisation's own weekly record).
begin;
drop function if exists public.dpdp_timer_icp_weekly(text, timestamptz, boolean);
drop function if exists dpdp.icp_firm_clients(text);
drop index if exists dpdp.icp_run_monday_once;
commit;
