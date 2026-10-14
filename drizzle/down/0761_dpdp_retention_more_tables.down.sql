-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7). Roll-back file for 0761_dpdp_retention_more_tables.sql; it is not run unless the project manager decides to undo that migration.
-- Roll-back of 0761: removes the file job and the two proof functions, restores the 0724 sweep (the six old rules and offboarding) and the original call-log guard
-- (nothing may delete from dpdp.ai_link_call), and drops the new settings columns. Rows the live sweep already deleted are not restored.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dpdp-retention-files';
  end if;
end
$$;

create or replace function dpdp.retention_kept_tables()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['event', 'access_log', 'daily_seal', 'organisation', 'org_offboarding', 'retention_run', 'retention_setting']::text[] $$;

drop function if exists public.dpdp_retention_proof_plan(boolean);
drop function if exists public.dpdp_retention_proof_done(text[], boolean, integer);

create or replace function dpdp.ai_link_call_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dpdp.ai_link_call is append-only' using errcode = '42501';
  end if;
  if old.status is not null
     or new.id is distinct from old.id
     or new.link_id is distinct from old.link_id
     or new.org_id is distinct from old.org_id
     or new.method is distinct from old.method
     or new.path is distinct from old.path
     or new.called_at is distinct from old.called_at then
    raise exception 'dpdp.ai_link_call is append-only -- only a pending row''s status/bytes/finished_at may be set, once' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function public.dpdp_timer_retention_sweep(p_force_dry_run boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_set dpdp.retention_setting;
  v_live boolean;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_nowtz timestamptz := clock_timestamp();
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_off record;
  v_report jsonb;
  v_orgs jsonb := '[]'::jsonb;
begin
  select * into v_set from dpdp.retention_setting where id = 1;
  v_live := coalesce(v_set.live, false) and not coalesce(p_force_dry_run, false);

  if to_regclass('dpdp.login_token') is not null then
    select count(*) into v_n from dpdp.login_token where expires_at < v_now - make_interval(days => v_set.login_token_days);
    if v_live and v_n > 0 then delete from dpdp.login_token where expires_at < v_now - make_interval(days => v_set.login_token_days); end if;
    v_counts := v_counts || jsonb_build_object('login_token', v_n);
  end if;
  if to_regclass('dpdp.session') is not null then
    select count(*) into v_n from dpdp.session where expires_at < v_now - make_interval(days => v_set.session_days);
    if v_live and v_n > 0 then delete from dpdp.session where expires_at < v_now - make_interval(days => v_set.session_days); end if;
    v_counts := v_counts || jsonb_build_object('session', v_n);
  end if;
  if to_regclass('dpdp.email_token') is not null then
    select count(*) into v_n from dpdp.email_token where expires_at < v_now - make_interval(days => v_set.email_token_days);
    if v_live and v_n > 0 then delete from dpdp.email_token where expires_at < v_now - make_interval(days => v_set.email_token_days); end if;
    v_counts := v_counts || jsonb_build_object('email_token', v_n);
  end if;
  if to_regclass('dpdp.mail_outbound') is not null then
    select count(*) into v_n from dpdp.mail_outbound where sent_at < v_nowtz - make_interval(days => v_set.mail_outbound_days);
    if v_live and v_n > 0 then delete from dpdp.mail_outbound where sent_at < v_nowtz - make_interval(days => v_set.mail_outbound_days); end if;
    v_counts := v_counts || jsonb_build_object('mail_outbound', v_n);
  end if;
  if to_regclass('dpdp.mail_inbound') is not null then
    select count(*) into v_n from dpdp.mail_inbound where closed_at is not null and closed_at < v_nowtz - make_interval(days => v_set.mail_inbound_closed_days);
    if v_live and v_n > 0 then delete from dpdp.mail_inbound where closed_at is not null and closed_at < v_nowtz - make_interval(days => v_set.mail_inbound_closed_days); end if;
    v_counts := v_counts || jsonb_build_object('mail_inbound_closed', v_n);
  end if;
  if to_regclass('dpdp.ai_link_seen') is not null then
    select count(*) into v_n from dpdp.ai_link_seen where first_seen_at < v_now - make_interval(days => v_set.ip_prefix_days);
    if v_live and v_n > 0 then delete from dpdp.ai_link_seen where first_seen_at < v_now - make_interval(days => v_set.ip_prefix_days); end if;
    v_counts := v_counts || jsonb_build_object('ai_link_seen', v_n);
  end if;

  for v_off in
    select o.org_id from dpdp.org_offboarding o
     where o.state = 'exporting' and o.export_until < v_now and o.exported_at is not null
     order by o.org_id
  loop
    v_orgs := v_orgs || jsonb_build_array(public.dpdp__offboard_delete(v_off.org_id, v_live));
  end loop;

  v_report := jsonb_build_object('live', v_live, 'ranAt', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'counts', v_counts, 'organisations', v_orgs);
  insert into dpdp.retention_run (live, report) values (v_live, v_report);
  return v_report;
end
$$;

revoke all on function public.dpdp_timer_retention_sweep(boolean) from public, anon, authenticated;
grant execute on function public.dpdp_timer_retention_sweep(boolean) to service_role;

alter table dpdp.retention_setting drop constraint if exists retention_setting_more_days_check;
alter table dpdp.retention_setting
  drop column if exists email_send_days,
  drop column if exists ai_link_call_days,
  drop column if exists ai_link_call_unknown_days,
  drop column if exists ai_link_ended_days,
  drop column if exists ai_link_read_days,
  drop column if exists payment_proof_days;
