-- PRE-APPROVED-LIVE-DDL: Rollback file for the owner requirement relayed by the boss session on 2026-11-14 (the DPDP Identify, Classify, Prove weekly lifecycle; see the matching up file, drizzle/0762_dpdp_icp_prove.sql). FILE ONLY: not applied to any database; running it live needs the owner's separate go and a recorded rollback id.
-- Rollback of 0762 (DPDP ICP slice 2, PROVE). Drops the evidence and erasure tables, the new functions, puts dpdp.icp_prove back to the 0761 placeholder, and removes
-- the grievance.received_at column. WARNING: dropping dpdp.icp_evidence / dpdp.icp_erasure deletes their rows. Rows 0762 wrote into the EXISTING dpdp.breach,
-- dpdp.rights_request and dpdp.grievance tables are NOT removed (they are the organisation's own records); the History events stay (the chain is append-only).
-- Run drizzle/down/0763 (and later) first if they were applied.
begin;
drop function if exists public.dpdp_icp_evidence_pack(text);
drop function if exists dpdp.icp_chain_check(text, integer);
drop function if exists public.dpdp_icp_prove_overview(text);
drop function if exists public.dpdp_icp_erasure_close(text, text, jsonb);
drop function if exists public.dpdp_icp_erasure_log(text, jsonb);
drop function if exists public.dpdp_icp_request_close(text, text, text);
drop function if exists public.dpdp_icp_request_log(text, jsonb);
drop function if exists public.dpdp_icp_breach_update(text, text, jsonb);
drop function if exists public.dpdp_icp_breach_log(text, jsonb);
drop function if exists public.dpdp_icp_evidence_withdraw(text, text, text);
drop function if exists public.dpdp_icp_evidence_add(text, jsonb);

-- the placeholder checklist step set from 0761 (jobs, history, sign-off)
create or replace function dpdp.icp_prove(p_org_id text, p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_late integer;
  v_events integer;
  v_signed boolean;
begin
  select count(*) into v_late from dpdp.obligation ob where ob.org_id = p_org_id and ob.state not in ('closed', 'submitted', 'not_applicable') and ob.due_on < (clock_timestamp() at time zone 'UTC')::date;
  select count(*) into v_events from dpdp.event e where e.org_id = p_org_id and e.occurred_at >= p_week::timestamp;
  select exists (select 1 from dpdp.icp_run r where r.org_id = p_org_id and r.week_start = p_week and r.stage = 'prove' and r.by_kind = 'person' and r.outcome = 'ok') into v_signed;
  return dpdp.icp_section(array[
    dpdp.icp_step('jobs_not_late', 'No job is late', v_late = 0, v_late, 'jobs'),
    dpdp.icp_step('history_written', 'This week''s work is on the record (History)', v_events > 0, v_events, 'history'),
    dpdp.icp_step('week_signed_off', 'A person signs off the week', v_signed, null, 'signoff')
  ]);
end
$$;
revoke all on function dpdp.icp_prove(text, date) from public, anon, authenticated;
drop function if exists dpdp.icp_prove_counts(text, date);

drop table if exists dpdp.icp_erasure;
drop trigger if exists icp_evidence_guard on dpdp.icp_evidence;
drop table if exists dpdp.icp_evidence;
drop function if exists dpdp.icp_evidence_guard();
alter table dpdp.grievance drop column if exists received_at;
commit;
