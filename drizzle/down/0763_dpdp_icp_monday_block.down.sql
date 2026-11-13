-- PRE-APPROVED-LIVE-DDL: Rollback file for the owner requirement relayed by the boss session on 2026-11-14 (the DPDP Identify, Classify, Prove weekly lifecycle; see the matching up file, drizzle/0763_dpdp_icp_monday_block.sql). FILE ONLY: not applied to any database; running it live needs the owner's separate go and a recorded rollback id.
-- Rollback of 0763 (DPDP ICP slice 3, the Monday e-mail block). Drops the function, its helper and the once-a-week index. Nothing else changes: the "Monday snapshot" rows it added to
-- dpdp.icp_run stay (that record is append-only by design, and they are the organisation's own weekly record).
begin;
drop function if exists public.dpdp_timer_icp_weekly(text, timestamptz, boolean);
drop function if exists dpdp.icp_firm_clients(text);
drop index if exists dpdp.icp_run_monday_once;
commit;
