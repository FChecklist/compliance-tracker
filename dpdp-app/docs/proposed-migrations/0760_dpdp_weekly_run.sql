-- DRAFT FOR REVIEW. NOT APPLIED to any database. Do not apply until the Owner/BOSS approves after CI is green.
-- Kept OUTSIDE drizzle/ on purpose: the DDL-authorization and journal-parity checks (rightly) refuse unapproved GRANT/SECURITY DEFINER/DROP there.
-- TO PROMOTE once approved: copy to drizzle/0760_dpdp_weekly_run.sql, add the line `-- PRE-APPROVED-LIVE-DDL: <real citation>`, add its drizzle/meta/_journal.json
-- entry, copy the .down.sql to drizzle/down/, and have the PM apply it through the Supabase MCP after CI is green.
--
-- DPDP weekly routine (Discover, Act, Confirm): a real record of every run, so the page can show "last run / next run / missed weeks" and each stage's
-- latest log from the server instead of inferring it from History. Written by (a) the automatic helper (the Monday reading, service role) and
-- (b) a person pressing "This week is checked" (owner, coordinator, Grievance Officer, CA).
--
--   dpdp.weekly_run   append-only: one row per run of one stage. No UPDATE or DELETE is ever offered.
--   public.dpdp_weekly_log(p_org_id, p_stage, p_outcome, p_note, p_by)   writes one row (person: members who can see the whole organisation;
--                                                                       software/device: service role only).
--   public.dpdp_weekly_runs(p_org_id, p_weeks)                          reads the last 1..8 weeks, newest first, for members of the organisation.
--
-- RLS: enabled with NO policies, so the table cannot be read or written directly by anon/authenticated; only these SECURITY DEFINER functions
-- (search_path = '') and the service role touch it. Same shape as dpdp.visit_* (0733). ADDITIVE ONLY: no existing table or row is touched.
-- IDEMPOTENT: IF NOT EXISTS / CREATE OR REPLACE. ROLLBACK: drizzle/down/0760_dpdp_weekly_run.down.sql (drops the two functions and the table).
BEGIN;
SET LOCAL lock_timeout = '5s';

create table if not exists dpdp.weekly_run (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references dpdp.organisation(id),
  stage text not null check (stage in ('discover', 'act', 'confirm')),
  week_start date not null check (extract(isodow from week_start) = 1), -- always a Monday (UTC)
  ran_at timestamptz not null default now(),
  by_kind text not null check (by_kind in ('person', 'device', 'software')),
  actor_label text,
  outcome text not null default 'ok' check (outcome in ('ok', 'partial', 'failed', 'skipped')),
  note text check (note is null or length(note) <= 500)
);
create index if not exists weekly_run_org_week_idx on dpdp.weekly_run (org_id, week_start desc, stage, ran_at desc);
alter table dpdp.weekly_run enable row level security;
revoke all on table dpdp.weekly_run from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Write one run. A person may only log if they see the whole organisation.
-- The helper (software) and device runs come from the service role (the Monday job), never from a browser.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_weekly_log(
  p_org_id text, p_stage text, p_outcome text default 'ok', p_note text default null, p_by text default 'person'
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_m dpdp.membership;
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_week date := (date_trunc('week', now() at time zone 'UTC'))::date;
  v_id text;
begin
  if p_stage not in ('discover', 'act', 'confirm') then
    raise exception 'Unknown stage' using errcode = '22023';
  end if;
  if p_outcome not in ('ok', 'partial', 'failed', 'skipped') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;
  if p_by not in ('person', 'device', 'software') then
    raise exception 'Unknown kind' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'A note can be 500 characters at most' using errcode = '22023';
  end if;
  if not exists (select 1 from dpdp.organisation o where o.id = p_org_id) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  if p_by = 'person' then
    v_identity := public.dpdp__caller_identity_id();
    v_m := public.dpdp__caller_membership(p_org_id);
    if v_identity is null or v_m.id is null then
      raise exception 'Organisation not found' using errcode = 'P0002'; -- never confirm the id exists
    end if;
    if coalesce(public.dpdp__viewer_kind(v_m.id) in ('staff', 'parent'), true) then
      raise exception 'Only the people who see the whole organisation can sign off the week' using errcode = '42501';
    end if;
    select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  elsif v_role <> 'service_role' then
    raise exception 'Only the automatic helper can record its own runs' using errcode = '42501';
  else
    v_label := case p_by when 'software' then 'Automatic helper' else 'Device' end;
  end if;

  insert into dpdp.weekly_run (org_id, stage, week_start, by_kind, actor_label, outcome, note)
  values (p_org_id, p_stage, v_week, p_by, v_label, p_outcome, v_note)
  returning id into v_id;

  -- A person's sign-off also lands in History (append-only, hash-chained) like every other action they take.
  if p_by = 'person' then
    perform public.dpdp__append_event(p_org_id, v_identity, v_label, 'weekly_run_logged',
      case p_stage
        when 'confirm' then 'Checked that this week is done'
        when 'act' then 'Finished the jobs for this week'
        else 'Reviewed what data the organisation holds'
      end,
      v_note);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'weekStart', to_char(v_week, 'YYYY-MM-DD'));
end
$$;

-- ---------------------------------------------------------------------
-- Read the last 1..8 weeks of runs (newest first, at most 200 rows). Any member of the organisation: the rhythm is not secret from staff.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_weekly_runs(p_org_id text, p_weeks integer default 4)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_weeks integer := least(greatest(coalesce(p_weeks, 4), 1), 8);
  v_since date := ((date_trunc('week', now() at time zone 'UTC'))::date - (v_weeks - 1) * 7);
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if public.dpdp__caller_identity_id() is null or v_m.id is null then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r."ranAt" desc)
    from (
      select w.id, w.stage, to_char(w.week_start, 'YYYY-MM-DD') as "weekStart", w.ran_at as "ranAt", w.by_kind as "byKind",
             w.actor_label as "actorLabel", w.outcome, w.note
      from dpdp.weekly_run w
      where w.org_id = p_org_id and w.week_start >= v_since
      order by w.ran_at desc
      limit 200
    ) r
  ), '[]'::jsonb);
end
$$;

revoke all on function public.dpdp_weekly_log(text, text, text, text, text) from public, anon;
revoke all on function public.dpdp_weekly_runs(text, integer) from public, anon;
grant execute on function public.dpdp_weekly_log(text, text, text, text, text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_weekly_runs(text, integer) to authenticated, app_runtime, service_role;

COMMIT;
