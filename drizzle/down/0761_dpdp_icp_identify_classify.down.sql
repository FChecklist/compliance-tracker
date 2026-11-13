-- Rollback of 0761 (DPDP ICP slice 1). Drops the register, the weekly record and every function 0761 added, and puts dpdp__append_event back exactly as 0605
-- defined it (no advisory lock). WARNING: dropping dpdp.icp_item / dpdp.icp_run deletes their rows; the mirrored dpdp.data_category / data_location rows
-- (ids starting icp_c_ / icp_l_) are removed too. Run drizzle/down/0762 (and later) first if they were applied.
begin;
drop function if exists public.dpdp_icp_run_software(text, text, text, text);
drop function if exists public.dpdp_icp_log(text, text, text, text);
drop function if exists public.dpdp_icp_status(text);
drop function if exists dpdp.icp_status_for(text, date);
drop function if exists dpdp.icp_prove(text, date);
drop function if exists dpdp.icp_classify(text, date);
drop function if exists dpdp.icp_identify(text, date);
drop function if exists dpdp.icp_section(jsonb[]);
drop function if exists dpdp.icp_step(text, text, boolean, integer, text);
drop function if exists public.dpdp_icp_apply_rules(text);
drop function if exists dpdp.icp_children_job_keys();
drop function if exists public.dpdp_icp_starter(text);
drop function if exists public.dpdp_icp_confirm_items(text, text[]);
drop function if exists public.dpdp_icp_retire_item(text, text, text);
drop function if exists public.dpdp_icp_save_item(text, jsonb);
drop function if exists public.dpdp_icp_register(text);
drop function if exists dpdp.icp_item_json(dpdp.icp_item, date, boolean);
delete from dpdp.data_location where id like 'icp\_l\_%';
delete from dpdp.data_category where id like 'icp\_c\_%';
drop function if exists dpdp.icp_mirror(text);
drop function if exists dpdp.icp_child_consent_answered(text);
drop function if exists dpdp.icp_item_flags(dpdp.icp_item, date, boolean);
drop function if exists dpdp.icp_flag_label(text);
drop function if exists public.dpdp__icp_member(text, boolean);
drop function if exists dpdp.icp_week(timestamp);
drop table if exists dpdp.icp_run;
drop function if exists dpdp.icp_run_no_change();
drop function if exists dpdp.icp_actor_label(dpdp.membership);
drop function if exists dpdp.icp_not_contact(text);
drop function if exists dpdp.icp_offboarding(text);
drop table if exists dpdp.icp_item;

create or replace function public.dpdp__append_event(
  p_org_id text, p_actor_identity_id text, p_actor_label text, p_kind text, p_summary text, p_detail text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_prev_ts timestamp;
  v_ts timestamp;
  v_canonical text;
  v_hash text;
begin
  select e.hash, e.occurred_at into v_prev, v_prev_ts
  from dpdp.event e
  where e.org_id = p_org_id
  order by e.occurred_at desc
  limit 1;

  v_ts := date_trunc('milliseconds', (clock_timestamp() at time zone 'UTC'));
  if v_prev_ts is not null and v_ts <= v_prev_ts then
    v_ts := v_prev_ts + interval '1 millisecond';
  end if;

  v_canonical := '{"actorLabel":' || to_json(p_actor_label)::text
    || ',"detail":'     || coalesce(to_json(p_detail)::text, 'null')
    || ',"kind":'       || to_json(p_kind)::text
    || ',"occurredAt":' || to_json(to_char(v_ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
    || ',"orgId":'      || to_json(p_org_id)::text
    || ',"prevHash":'   || coalesce(to_json(v_prev)::text, 'null')
    || ',"summary":'    || to_json(p_summary)::text
    || '}';
  v_hash := encode(sha256(convert_to(coalesce(v_prev, '') || v_canonical, 'UTF8')), 'hex');

  insert into dpdp.event (id, org_id, actor_identity_id, actor_label, kind, summary, detail, occurred_at, prev_hash, hash)
  values (replace(gen_random_uuid()::text, '-', ''), p_org_id, p_actor_identity_id, p_actor_label, p_kind, p_summary, p_detail, v_ts, v_prev, v_hash);
end
$$;
revoke all on function public.dpdp__append_event(text, text, text, text, text, text) from public, anon, authenticated;
commit;
