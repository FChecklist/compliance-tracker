-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 3 (retention sweep, dry-run by default; organisation offboarding)
--
-- DPDP compliance programme, Wave 3. The Privacy Notice promises limited retention; until now nothing enforced it. This migration adds:
--  1. dpdp.retention_setting: ONE row. live = false (the default) means the sweep only COUNTS what it would delete. Nothing is ever deleted until the
--     owner reads a few dry-run reports and runs: update dpdp.retention_setting set live = true where id = 1;
--     The periods are the schedule in ai-os/dpdp-governance/RETENTION_SCHEDULE.md (a draft for the lawyer): sign-in codes and sessions 30 days after they
--     expire, e-mail confirm links 30 days after they expire, the sent-mail log 13 months, closed inbound mail tickets 24 months, network-prefix
--     records 90 days, an ended organisation's data 30 days after it is told its export is ready.
--  2. public.dpdp_timer_retention_sweep(p_force_dry_run): counts (and, only when live, deletes) per rule, writes one dpdp.retention_run row with the
--     count report, returns it. Each rule is skipped if its table does not exist. Run daily by pg_cron (below), as the table owner. Executable by
--     service_role only.
--  3. Organisation offboarding: dpdp.org_offboarding (one row per ended organisation) and three functions. dpdp_operator_offboard_start (platform admin)
--     marks the end and sets export_until = now + 30 days; dpdp_operator_offboard_export (platform admin) returns every row of the organisation as JSON
--     and stamps exported_at; the daily sweep deletes the organisation's data ONLY when export_until has passed AND the export was made, and (like the
--     rest) only counts while live = false. Append-only records (the hash-chained event log, access log, daily seals) are never deleted by this; they are
--     reported as kept. If the organisation row itself is still referenced (for example by a kept record) it is kept and the report says so.
-- Roll-back: drizzle/down/0700_dpdp_retention_sweep_and_offboarding.down.sql.

create table if not exists dpdp.retention_setting (
  id integer primary key check (id = 1),
  live boolean not null default false,
  login_token_days integer not null default 30 check (login_token_days >= 1),
  session_days integer not null default 30 check (session_days >= 1),
  email_token_days integer not null default 30 check (email_token_days >= 1),
  mail_outbound_days integer not null default 395 check (mail_outbound_days >= 30),
  mail_inbound_closed_days integer not null default 730 check (mail_inbound_closed_days >= 30),
  ip_prefix_days integer not null default 90 check (ip_prefix_days >= 1),
  offboard_export_days integer not null default 30 check (offboard_export_days >= 1),
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
insert into dpdp.retention_setting (id) values (1) on conflict (id) do nothing;

create table if not exists dpdp.retention_run (
  id bigint generated always as identity primary key,
  ran_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  live boolean not null,
  report jsonb not null
);

create table if not exists dpdp.org_offboarding (
  org_id text primary key,
  started_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  export_until timestamp not null,
  exported_at timestamp,
  state text not null default 'exporting' check (state in ('exporting', 'deleted', 'cancelled')),
  report jsonb
);

alter table dpdp.retention_setting enable row level security;
alter table dpdp.retention_run enable row level security;
alter table dpdp.org_offboarding enable row level security;
revoke all on table dpdp.retention_setting, dpdp.retention_run, dpdp.org_offboarding from public, anon, authenticated;

-- Tables a sweep or an offboarding must never delete from: the append-only records and the sweep's own books.
create or replace function dpdp.retention_kept_tables()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['event', 'access_log', 'daily_seal', 'organisation', 'org_offboarding', 'retention_run', 'retention_setting']::text[] $$;

-- The daily sweep.
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

  -- Only CLOSED inbound tickets age out; an open ticket is kept however old it is.
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

  -- Ended organisations whose export period is over and whose export was made.
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

-- Deletes (or, when not live, counts) everything of one organisation that may be deleted. Returns a report. Internal: called by the sweep only.
create or replace function public.dpdp__offboard_delete(p_org_id text, p_live boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tables text[];
  v_pending text[];
  v_next text[];
  v_t text;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_kept jsonb := '{}'::jsonb;
  v_pass integer := 0;
  v_progress boolean;
  v_org_deleted boolean := false;
  v_note text := null;
begin
  select array_agg(c.table_name::text order by c.table_name) into v_tables
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'dpdp' and c.column_name = 'org_id' and c.table_name <> all (dpdp.retention_kept_tables());

  -- what stays, and why
  foreach v_t in array array['event', 'access_log', 'daily_seal'] loop
    if to_regclass('dpdp.' || v_t) is not null then
      begin
        execute format('select count(*) from dpdp.%I where org_id = $1', v_t) into v_n using p_org_id;
        v_kept := v_kept || jsonb_build_object(v_t, v_n);
      exception when others then null;
      end;
    end if;
  end loop;

  foreach v_t in array coalesce(v_tables, '{}'::text[]) loop
    execute format('select count(*) from dpdp.%I where org_id = $1', v_t) into v_n using p_org_id;
    v_counts := v_counts || jsonb_build_object(v_t, v_n);
  end loop;

  if p_live then
    v_pending := coalesce(v_tables, '{}'::text[]);
    while coalesce(array_length(v_pending, 1), 0) > 0 and v_pass < 12 loop
      v_pass := v_pass + 1;
      v_progress := false;
      v_next := '{}'::text[];
      foreach v_t in array v_pending loop
        begin
          execute format('delete from dpdp.%I where org_id = $1', v_t) using p_org_id;
          v_progress := true;
        exception when foreign_key_violation then
          v_next := v_next || v_t; -- something still points at it: try again after the others
        end;
      end loop;
      v_pending := v_next;
      exit when not v_progress;
    end loop;
    if coalesce(array_length(v_pending, 1), 0) > 0 then
      v_note := 'not deleted (still referenced): ' || array_to_string(v_pending, ', ');
    end if;
    begin
      delete from dpdp.organisation where id = p_org_id;
      v_org_deleted := true;
    exception when foreign_key_violation then
      v_note := coalesce(v_note || '; ', '') || 'organisation row kept: a record that must be kept still refers to it';
    end;
    update dpdp.org_offboarding
       set state = case when coalesce(array_length(v_pending, 1), 0) = 0 then 'deleted' else state end,
           report = jsonb_build_object('deleted', v_counts, 'kept', v_kept, 'organisationRowDeleted', v_org_deleted, 'note', v_note)
     where org_id = p_org_id;
  end if;

  return jsonb_build_object('orgId', p_org_id, 'live', p_live, 'wouldDeleteOrDeleted', v_counts, 'kept', v_kept, 'organisationRowDeleted', v_org_deleted, 'note', v_note);
end
$$;

-- Operator: an organisation has ended. Starts the export period.
create or replace function public.dpdp_operator_offboard_start(p_org_id text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_until timestamp;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Only the platform operator can end an organisation' using errcode = '42501';
  end if;
  if not exists (select 1 from dpdp.organisation where id = p_org_id) then
    raise exception 'No such organisation' using errcode = 'P0002';
  end if;
  select offboard_export_days into v_days from dpdp.retention_setting where id = 1;
  v_until := (clock_timestamp() at time zone 'UTC') + make_interval(days => v_days);
  insert into dpdp.org_offboarding (org_id, export_until) values (p_org_id, v_until)
    on conflict (org_id) do update set state = 'exporting', export_until = excluded.export_until, started_at = (clock_timestamp() at time zone 'UTC'), exported_at = null, report = null
    where dpdp.org_offboarding.state <> 'deleted';
  return jsonb_build_object('orgId', p_org_id, 'exportUntil', to_char(v_until, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'next', 'Run dpdp_operator_offboard_export, hand the file to the customer, and the daily sweep deletes the data after exportUntil (only once retention is live).');
end
$$;

-- Operator: the organisation's data as JSON (every dpdp table that has an org_id), stamped as exported.
create or replace function public.dpdp_operator_offboard_export(p_org_id text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_t text;
  v_rows jsonb;
  v_out jsonb := '{}'::jsonb;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Only the platform operator can export an organisation' using errcode = '42501';
  end if;
  if not exists (select 1 from dpdp.org_offboarding where org_id = p_org_id and state = 'exporting') then
    raise exception 'Start the offboarding first' using errcode = '55000';
  end if;
  for v_t in
    select c.table_name::text from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'dpdp' and c.column_name = 'org_id' and c.table_name not in ('org_offboarding', 'retention_run', 'retention_setting')
     order by c.table_name
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from dpdp.%I x where x.org_id = $1', v_t) into v_rows using p_org_id;
    if jsonb_array_length(v_rows) > 0 then
      v_out := v_out || jsonb_build_object(v_t, v_rows);
    end if;
  end loop;
  update dpdp.org_offboarding set exported_at = (clock_timestamp() at time zone 'UTC') where org_id = p_org_id;
  return jsonb_build_object('orgId', p_org_id, 'exportedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'tables', v_out);
end
$$;

revoke all on function public.dpdp_timer_retention_sweep(boolean) from public, anon, authenticated;
revoke all on function public.dpdp__offboard_delete(text, boolean) from public, anon, authenticated;
revoke all on function dpdp.retention_kept_tables() from public, anon, authenticated;
revoke all on function public.dpdp_operator_offboard_start(text) from public, anon;
revoke all on function public.dpdp_operator_offboard_export(text) from public, anon;
grant execute on function public.dpdp_timer_retention_sweep(boolean) to service_role;
grant execute on function public.dpdp_operator_offboard_start(text) to authenticated, app_runtime;
grant execute on function public.dpdp_operator_offboard_export(text) to authenticated, app_runtime;

-- The daily job: pure SQL, no network. Runs as the owner. Same upsert-by-name pattern as the other dpdp jobs.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dpdp-retention-sweep', '10 2 * * *', 'select public.dpdp_timer_retention_sweep()');
  end if;
end
$$;
