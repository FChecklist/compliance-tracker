-- Rollback of 0763 (DPDP ICP slice 3, the Monday e-mail block). Drops the one function. Nothing else changes: the "Monday snapshot" rows it added to
-- dpdp.icp_run stay (that record is append-only by design, and they are the organisation's own weekly record).
begin;
drop function if exists public.dpdp_timer_icp_weekly(text, timestamptz, boolean);
commit;
