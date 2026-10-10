-- WO-DPDP-013 v2 PART 1 -- "the inside door": the AI work link. Builds on
-- 0607 (dpdp.ai_link / dpdp.ai_draft, hashed tokens, service-role-only
-- readers) and turns the single read-only snapshot into a small API with
-- three levels of authority, an append-only call log, and 24-hour-undoable
-- Level 1 actions. Order of work per WO §4: item 3 (security: tokens,
-- levels, RLS, cross-tenant + level tests), item 4 (the API: Level 0 first,
-- then drafts, then Level 1 behind its switch). Item 5 (the generated
-- manual) lives in supabase/functions/dpdp-ai-link/.
--
-- The three levels (WO §1.2, an owner decision recorded there):
--   0  read, analyse, report -- always on.
--   1  NOTE / SET_DUE / ASSIGN (existing members only) / MARK_NA, applied
--      directly under the link's own person's authority, each written to
--      history as "by <person> via AI assistant", flagged for that person's
--      next Monday email, undoable for 24 hours. OFF by default; the person
--      switches it on per link when they make it.
--   2  anything with legal weight -- never a link property, never direct:
--      the AI creates a DRAFT (dpdp.ai_draft, 0607) and the person confirms
--      it in their own browser (dpdp_confirm_ai_draft). Level 2 verbs are
--      refused by dpdp_ai_link_action for EVERY link, whatever its level.
--
-- Additive only (WO-011 §6, CONSTITUTION): ai_link gains columns with
-- defaults; ai_link_call and ai_action are new; ai_draft's verb allowlist is
-- WIDENED (the CHECK is dropped and re-created with the Level 2 list --
-- every value it accepted before it still accepts); dpdp_ai_link_read and
-- dpdp_confirm_ai_draft are re-created with the same signature and the same
-- return shape (read: honours hide_emails; confirm: knows the Level 2 verbs).
-- 0607's dpdp_draft_action / dpdp_create_ai_link / dpdp_revoke_ai_link are
-- left exactly as they are.
--
-- Conventions, all from 0604/0607: functions live in `public` (the only
-- schema PostgREST exposes here), SECURITY DEFINER with search_path = '',
-- owned by postgres so RLS never applies inside them and EVERY scope is an
-- explicit WHERE; refusals raise 42501 with a plain-English message, caller
-- mistakes raise 22023; the caller is resolved from the JWT via
-- dpdp__caller_membership; events go through dpdp__append_event; pgcrypto
-- is in `extensions`; naive timestamps hold UTC digits. "Today" for
-- lateness is the IST date, as 0606's digest computes it.
--
-- Two deviations from the PM's brief, both deliberate and both flagged in
-- the PR: (1) the call log is completed in place (status/bytes/finished_at
-- filled once on the pending row) rather than written twice -- a trigger
-- refuses DELETE and any other UPDATE, so the log is still append-only in
-- every way that matters; (2) the plain-English meaning of a law code is
-- not in the database (no table holds per-section text), so
-- dpdp_ai_link_law returns the in-force fact and the jobs in THIS view that
-- cite the code, and the Edge Function adds the topic text from the same
-- citation table the public job pages use (law.ts, a port of law.mjs).

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

alter table dpdp.ai_link add column if not exists authority_level smallint not null default 0;
alter table dpdp.ai_link add column if not exists hide_emails boolean not null default false;
alter table dpdp.ai_link add column if not exists created_by_membership_id text;
alter table dpdp.ai_link add column if not exists label text;
alter table dpdp.ai_link add column if not exists last_used_at timestamp;
alter table dpdp.ai_link add column if not exists call_count integer not null default 0;
do $$ begin
  alter table dpdp.ai_link add constraint ai_link_authority_level_check check (authority_level in (0, 1));
exception when duplicate_object then null; end $$;

-- EVERY API call, whatever it returned. link_id is null only when the token
-- matched no row at all (nothing is stored about an unknown token beyond
-- the fact that a call was made). A row is inserted before the call is
-- served (status null) and completed once afterwards -- see the guard
-- trigger below.
create table if not exists dpdp.ai_link_call (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  link_id text,
  org_id text,
  method text not null,
  path text not null,
  status integer,
  bytes integer,
  called_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  finished_at timestamp
);
create index if not exists ai_link_call_link_called_idx on dpdp.ai_link_call (link_id, called_at desc);

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
drop trigger if exists ai_link_call_guard on dpdp.ai_link_call;
create trigger ai_link_call_guard before update or delete on dpdp.ai_link_call
  for each row execute function dpdp.ai_link_call_guard();

-- One row per Level 1 action an AI applied. `previous` holds what the job
-- looked like before, so undo can put it back. undo_token_hash is sha256 of
-- a token returned once to the caller (and re-mintable for the Monday
-- email by dpdp_timer_issue_undo_token). digest_pending is the flag the
-- Monday digest reads (dpdp_timer_ai_actions_for_digest).
create table if not exists dpdp.ai_action (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  link_id text not null,
  membership_id text not null,
  org_id text not null,
  verb text not null,
  obligation_id text not null,
  value jsonb not null default '{}'::jsonb,
  previous jsonb,
  applied_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  undoable_until timestamp not null,
  undo_token_hash text,
  undone_at timestamp,
  digest_pending boolean not null default true,
  digested_at timestamp,
  constraint ai_action_verb_allowlist check (verb in ('NOTE', 'SET_DUE', 'ASSIGN', 'MARK_NA')),
  constraint ai_action_undo_token_hash_unique unique (undo_token_hash)
);
create index if not exists ai_action_org_id_idx on dpdp.ai_action (org_id);
create index if not exists ai_action_membership_applied_idx on dpdp.ai_action (membership_id, applied_at desc);

-- Level 2 verbs join the draft allowlist (WIDENED, never narrowed: the five
-- 0607 verbs stay so nothing that drafted before stops drafting).
alter table dpdp.ai_draft drop constraint if exists ai_draft_verb_allowlist;
alter table dpdp.ai_draft add constraint ai_draft_verb_allowlist check (verb in (
  'ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA', 'DRAFT',
  'MARK_DONE', 'OWNER_CONFIRM', 'MANAGER_CHECK', 'PARTNER_SIGN', 'DELETE', 'ADD_PERSON', 'REMOVE_PERSON',
  'CHANGE_SIGNER', 'PUBLISH', 'EXPORT_PERSONAL_DATA'
));

-- RLS: no anon/authenticated grant of any kind on either table (the browser
-- only ever reaches them through the RPCs). service_role bypasses as on
-- every sibling; app_runtime gets the same org-scoped policy every direct-
-- org_id dpdp table has (0415/0424/0607 pattern) so the repo's DB-gated
-- tests can inspect rows under a tenant context -- SELECT only on the call
-- log (it is append-only even for the server).
alter table dpdp.ai_link_call enable row level security;
alter table dpdp.ai_action enable row level security;
do $$ begin
  create policy service_role_bypass on dpdp.ai_link_call for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy app_runtime_org_scoped on dpdp.ai_link_call
    for select to app_runtime
    using (org_id = dpdp.current_org_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy service_role_bypass on dpdp.ai_action for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy app_runtime_org_scoped on dpdp.ai_action
    for all to app_runtime
    using (org_id = dpdp.current_org_id())
    with check (org_id = dpdp.current_org_id());
exception when duplicate_object then null; end $$;
grant select, insert, update on dpdp.ai_link_call to service_role;
grant select on dpdp.ai_link_call to app_runtime;
grant select, insert, update, delete on dpdp.ai_action to service_role, app_runtime;

-- ---------------------------------------------------------------------
-- 2. Internal helpers -- callable by nobody directly (revoked below).
-- ---------------------------------------------------------------------

-- The Level 1 and Level 2 verb lists, in one place each.
create or replace function public.dpdp__ai_level1_verbs()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['NOTE', 'SET_DUE', 'ASSIGN', 'MARK_NA']::text[] $$;

create or replace function public.dpdp__ai_level2_verbs()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['MARK_DONE', 'OWNER_CONFIRM', 'MANAGER_CHECK', 'PARTNER_SIGN', 'DELETE', 'ADD_PERSON', 'REMOVE_PERSON', 'CHANGE_SIGNER', 'PUBLISH', 'EXPORT_PERSONAL_DATA']::text[] $$;

-- hide_emails: every email address that is not the link's own person's
-- becomes "[email hidden]". Used on history text; rows use the role label
-- from dpdp__ai_link_job_rows instead.
create or replace function public.dpdp__ai_mask_emails(p_text text, p_keep_email text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_out text := p_text;
  v_hit text;
begin
  if p_text is null then
    return null;
  end if;
  for v_hit in select distinct m[1] from regexp_matches(p_text, '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') as m
  loop
    if lower(v_hit) <> lower(coalesce(p_keep_email, '')) then
      v_out := replace(v_out, v_hit, '[email hidden]');
    end if;
  end loop;
  return v_out;
end
$$;

-- The rows a link may see, as a typed table: 0607's row builder plus the
-- fields the API adds (status words, lateness, required-by-today's-law,
-- role label), with the one-page staff visibility rule applied (a staff or
-- parent viewer sees their own jobs and the group jobs they are in; owner,
-- coordinator, grievance officer and CA see the whole org). hide_emails
-- replaces every other person's email in `by` with their role: the owner's
-- membership level, else the job's own area/role tag.
do $$ begin
  create type dpdp.ai_job_row as (
    id text, part integer, what text, "dataSet" text, "dataTypes" text[], "lawCodes" text[],
    "by" text, "byIsYou" boolean, "isGroup" boolean, "groupDone" integer, "groupTotal" integer,
    due date, yes boolean, na boolean, "dependsOnObligationId" text,
    status text, "daysLate" integer, late boolean, "requiredToday" boolean, template_key text
  );
exception when duplicate_object then null; end $$;

create or replace function public.dpdp__ai_link_job_rows(p_link dpdp.ai_link)
returns setof dpdp.ai_job_row
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_email text;
  v_kind text;
  v_today date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_link.membership_id;
  if v_m.id is null then
    return;
  end if;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  v_kind := public.dpdp__viewer_kind(v_m.id);

  return query
  with r as (
    select
      o.id,
      t.part,
      t.name as what,
      t.data_set as "dataSet",
      t.data_types as "dataTypes",
      t.law_codes as "lawCodes",
      case
        when o.assigned_staff_group_id is not null then (select g.label from dpdp.staff_group g where g.id = o.assigned_staff_group_id)
        when o.assigned_person_id is null then null
        when o.assigned_person_id = v_m.identity_id or not p_link.hide_emails then (select i.primary_email from dpdp.identity i where i.id = o.assigned_person_id)
        when exists (select 1 from dpdp.membership pm where pm.identity_id = o.assigned_person_id and pm.org_id = o.org_id and pm.level = 'owner') then 'the owner'
        else coalesce(t.role_tag, 'a member')
      end as by,
      coalesce(o.assigned_staff_group_id is null and o.assigned_person_id = v_m.identity_id, false) as "byIsYou",
      (o.assigned_staff_group_id is not null) as "isGroup",
      case when o.assigned_staff_group_id is not null then o.progress_done end as "groupDone",
      case when o.assigned_staff_group_id is not null then o.progress_total end as "groupTotal",
      (o.assigned_staff_group_id is not null and exists (
        select 1 from dpdp.staff_group_member sgm where sgm.group_id = o.assigned_staff_group_id and sgm.membership_id = v_m.id
      )) as in_group,
      o.due_on as due,
      (o.state in ('closed', 'submitted')) as yes,
      (o.state = 'not_applicable') as na,
      o.depends_on_obligation_id as "dependsOnObligationId",
      o.assigned_person_id as person_id,
      t.key as template_key
    from dpdp.obligation o
    join dpdp.obligation_template t on t.id = o.template_id
    where o.org_id = v_m.org_id
  )
  select
    r.id, r.part, r.what, r."dataSet", r."dataTypes", r."lawCodes",
    r.by, r."byIsYou", r."isGroup", r."groupDone", r."groupTotal",
    r.due, r.yes, r.na, r."dependsOnObligationId",
    case
      when r.na then 'not applicable'
      when r.yes then 'done'
      when r.due < v_today then 'late'
      when r.due = v_today then 'due today'
      else 'open'
    end as status,
    case when not r.na and not r.yes and r.due < v_today then (v_today - r.due) else 0 end as "daysLate",
    (not r.na and not r.yes and r.due < v_today) as late,
    dpdp.required_today(r."lawCodes") as "requiredToday",
    r.template_key
  from r
  where v_kind not in ('staff', 'parent')
     or r.person_id = v_m.identity_id
     or r.in_group
  order by r.template_key;
end
$$;

-- One job row as JSON (the shape GET /jobs returns), from the typed row.
create or replace function public.dpdp__ai_job_json(r dpdp.ai_job_row)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'part', r.part, 'what', r.what, 'dataSet', r."dataSet",
    'dataTypes', to_jsonb(r."dataTypes"), 'lawCodes', to_jsonb(r."lawCodes"),
    'by', r.by, 'byIsYou', r."byIsYou", 'isGroup', r."isGroup", 'groupDone', r."groupDone", 'groupTotal', r."groupTotal",
    'due', to_char(r.due, 'YYYY-MM-DD'), 'yes', r.yes, 'na', r.na, 'dependsOnObligationId', r."dependsOnObligationId",
    'status', r.status, 'daysLate', r."daysLate", 'late', r.late, 'requiredToday', r."requiredToday"
  )
$$;

-- The data-warning numbers the Copy-AI-link screen shows BEFORE the link
-- exists: how many jobs, and how many people's emails, this membership's
-- view contains (the viewer counts as one of the people).
create or replace function public.dpdp__ai_link_warning_for(p_membership_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_probe dpdp.ai_link;
  v_jobs integer;
  v_people integer;
begin
  -- A throw-away link record (never inserted) so the row builder can
  -- answer for a link that does not exist yet.
  v_probe.membership_id := p_membership_id;
  v_probe.hide_emails := false;
  select count(*), count(distinct lower(r.by)) filter (where r.by is not null and not r."isGroup")
  into v_jobs, v_people
  from public.dpdp__ai_link_job_rows(v_probe) r;
  -- The viewer's own email is in the view (context, history) even when no
  -- job is theirs.
  if not exists (
    select 1 from public.dpdp__ai_link_job_rows(v_probe) r where r."byIsYou"
  ) then
    v_people := v_people + 1;
  end if;
  return jsonb_build_object('jobs', coalesce(v_jobs, 0), 'people', coalesce(v_people, 0));
end
$$;

-- ---------------------------------------------------------------------
-- 3. Browser-callable (authenticated): make, list, revoke, preview, undo.
-- ---------------------------------------------------------------------

-- The numbers for the warning sentence before "Copy link".
create or replace function public.dpdp_ai_link_warning(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  return public.dpdp__ai_link_warning_for(v_m.id);
end
$$;

-- "Copy AI link" (WO-013 §1.1): the plaintext token ONCE; only sha256 is
-- stored. p_level 0 (default) or 1; p_days one of 1 / 7 / 30 (default 7);
-- p_hide_emails shows other people's roles instead of their emails;
-- p_label is the person's own name for the link ("ChatGPT, Sept"). Several
-- live links per membership are allowed (each is listed and revocable on
-- its own -- "Your AI links"); 0607's one-live-link rule applies only to
-- 0607's own dpdp_create_ai_link, which is untouched.
create or replace function public.dpdp_ai_link_create(
  p_level integer default 0, p_hide_emails boolean default false, p_days integer default 7, p_label text default null, p_org_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_email text;
  v_token text;
  v_hash text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
  v_id text;
  v_level integer := coalesce(p_level, 0);
  v_days integer := coalesce(p_days, 7);
  v_label text := nullif(left(trim(coalesce(p_label, '')), 80), '');
  v_warning jsonb;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_level not in (0, 1) then
    raise exception 'level must be 0 (read, analyse, report) or 1 (small edits, directly). Anything with legal weight is always a draft.' using errcode = '22023';
  end if;
  if v_days not in (1, 7, 30) then
    raise exception 'The link can last 1, 7 or 30 days' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(days => v_days);
  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into dpdp.ai_link (
    id, org_id, identity_id, membership_id, token, token_hash, created_at, expires_at, read_count,
    authority_level, hide_emails, created_by_membership_id, label, call_count
  ) values (
    v_id, v_m.org_id, v_m.identity_id, v_m.id, null, v_hash, v_now, v_expires, 0,
    v_level, coalesce(p_hide_emails, false), v_m.id, v_label, 0
  );

  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(
    v_m.org_id, v_m.identity_id, v_email, 'ai_link_created', 'Made an AI work link',
    'Level ' || v_level || case when v_level = 1 then ' (small edits, directly)' else ' (read, analyse, report)' end
      || case when coalesce(p_hide_emails, false) then ', other people''s emails hidden' else '' end
      || ', expires ' || to_char(v_expires, 'YYYY-MM-DD HH24:MI') || ' UTC'
      || case when v_label is not null then ', "' || v_label || '"' else '' end
  );

  v_warning := public.dpdp__ai_link_warning_for(v_m.id);
  return jsonb_build_object(
    'linkId', v_id,
    'token', v_token,
    'level', v_level,
    'hideEmails', coalesce(p_hide_emails, false),
    'label', v_label,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'jobs', v_warning -> 'jobs',
    'people', v_warning -> 'people'
  );
end
$$;

-- "Your AI links": every link this person made in this org, newest first,
-- live or not (revoked/expired ones stay listed so the page can say so).
create or replace function public.dpdp_ai_link_list(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_out jsonb;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'label', l.label,
    'level', l.authority_level,
    'hideEmails', l.hide_emails,
    'createdAt', to_char(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'expiresAt', to_char(l.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'revokedAt', case when l.revoked_at is null then null else to_char(l.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'lastUsedAt', case when l.last_used_at is null then null else to_char(l.last_used_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'callCount', l.call_count,
    'active', (l.revoked_at is null and l.expires_at > v_now)
  ) order by l.created_at desc), '[]'::jsonb)
  into v_out
  from dpdp.ai_link l
  where l.membership_id = v_m.id and l.token_hash is not null;
  return v_out;
end
$$;

-- Revoke: effective on the next call (every token-taking function below
-- re-reads the row). Same rule as 0607's dpdp_revoke_ai_link, which it
-- calls: the link's own person, or the org's owner.
create or replace function public.dpdp_ai_link_revoke(p_id text)
returns jsonb
language sql security definer
set search_path = ''
as $$ select public.dpdp_revoke_ai_link(p_id) $$;

-- Undo a Level 1 action within 24 hours: the SIGNED-IN person who owns the
-- action (their own membership, or the org's owner), holding the undo
-- token. Puts back exactly what `previous` recorded; a NOTE cannot be
-- unwritten from an append-only history, so its undo is a "withdrew the
-- note" event.
create or replace function public.dpdp_ai_action_undo(p_action_id text, p_undo_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a dpdp.ai_action;
  v_m dpdp.membership;
  v_email text;
  v_name text;
  v_what text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select a.* into v_a from dpdp.ai_action a where a.id = p_action_id;
  if v_a.id is null
     or v_a.undo_token_hash is null
     or v_a.undo_token_hash <> encode(sha256(convert_to(left(coalesce(p_undo_token, ''), 256), 'UTF8')), 'hex') then
    raise exception 'This undo link is not valid' using errcode = '42501';
  end if;
  v_m := public.dpdp__caller_membership(v_a.org_id);
  if v_m.id is null or (v_m.id <> v_a.membership_id and v_m.level <> 'owner') then
    raise exception 'Only the person whose AI assistant made this change (or the owner) can undo it' using errcode = '42501';
  end if;
  if v_a.undone_at is not null then
    raise exception 'This change was already undone' using errcode = 'P0001';
  end if;
  if v_a.undoable_until <= v_now then
    raise exception 'This change can no longer be undone -- the 24 hours have passed' using errcode = 'P0001';
  end if;

  select t.name into v_name
  from dpdp.obligation o join dpdp.obligation_template t on t.id = o.template_id
  where o.id = v_a.obligation_id;
  v_name := coalesce(v_name, 'a job');

  case v_a.verb
    when 'NOTE' then
      v_what := 'withdrew the note on "' || v_name || '"';
    when 'SET_DUE' then
      update dpdp.obligation set due_on = (v_a.previous ->> 'dueOn')::date where id = v_a.obligation_id;
      v_what := 'put "' || v_name || '" back to due on ' || (v_a.previous ->> 'dueOn');
    when 'ASSIGN' then
      update dpdp.obligation
      set assigned_person_id = nullif(v_a.previous ->> 'assignedPersonId', ''), state = coalesce(v_a.previous ->> 'state', state)
      where id = v_a.obligation_id;
      v_what := 'gave "' || v_name || '" back to ' || coalesce(v_a.previous ->> 'assignedEmail', 'nobody');
    when 'MARK_NA' then
      update dpdp.obligation
      set state = coalesce(v_a.previous ->> 'state', 'open'), na_reason = nullif(v_a.previous ->> 'naReason', '')
      where id = v_a.obligation_id;
      v_what := 'un-marked "' || v_name || '" (it applies again)';
    else
      raise exception 'Unknown verb' using errcode = '22023';
  end case;

  update dpdp.ai_action set undone_at = v_now where id = v_a.id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(
    v_a.org_id, v_m.identity_id, v_email, 'ai_action_undone',
    'by ' || v_email || ' -- undid an AI assistant change: ' || v_what
  );
  return jsonb_build_object('ok', true, 'verb', v_a.verb, 'jobId', v_a.obligation_id);
end
$$;

-- ---------------------------------------------------------------------
-- 4. Service-role only (the Edge Function). The token is the credential;
--    there is no JWT on these calls. Every one of them resolves the token
--    through 0607's dpdp__ai_link_for_token, which refuses unknown,
--    expired, revoked and no-longer-a-member with ONE sentence.
-- ---------------------------------------------------------------------

-- The call log, first half: one pending row per request, plus the number
-- of calls this link made in the last 60 seconds (the rate limit is
-- decided from this count by the Edge Function: 120 per minute). Never
-- raises for a bad token -- the data call that follows does that; a call
-- with an unknown token is logged with link_id null.
create or replace function public.dpdp_ai_link_log_call(p_token text, p_method text, p_path text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_l dpdp.ai_link;
  v_id text;
  v_recent integer := 0;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_hash := encode(sha256(convert_to(left(coalesce(p_token, ''), 256), 'UTF8')), 'hex');
  select l.* into v_l from dpdp.ai_link l where l.token_hash = v_hash;
  if v_l.id is not null then
    select count(*) into v_recent from dpdp.ai_link_call c
    where c.link_id = v_l.id and c.called_at > v_now - interval '60 seconds';
    update dpdp.ai_link set call_count = call_count + 1, last_used_at = v_now where id = v_l.id;
  end if;
  insert into dpdp.ai_link_call (link_id, org_id, method, path, called_at)
  values (v_l.id, v_l.org_id, left(coalesce(p_method, ''), 10), left(coalesce(p_path, ''), 512), v_now)
  returning id into v_id;
  return jsonb_build_object('callId', v_id, 'linkId', v_l.id, 'callsLastMinute', v_recent + 1, 'limitPerMinute', 120);
end
$$;

-- The call log, second half: the outcome, set once.
create or replace function public.dpdp_ai_link_log_call_result(p_call_id text, p_status integer, p_bytes integer default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  update dpdp.ai_link_call
  set status = p_status, bytes = p_bytes, finished_at = (clock_timestamp() at time zone 'UTC')
  where id = p_call_id and status is null;
  return jsonb_build_object('ok', found);
end
$$;

-- GET /context: who the AI is working for, at which level, until when,
-- and which library version the jobs come from. No ids of anyone else,
-- no sign-in token of any kind.
create or replace function public.dpdp_ai_link_context(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_org dpdp.organisation;
  v_lib dpdp.library_version;
  v_email text;
  v_kind text;
  v_warning jsonb;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;
  select o.* into v_org from dpdp.organisation o where o.id = v_m.org_id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  select v.* into v_lib from dpdp.library_version v where v.is_current = true limit 1;
  v_kind := public.dpdp__viewer_kind(v_m.id);
  v_warning := public.dpdp__ai_link_warning_for(v_m.id);
  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'product', coalesce(v_org.product, 'firm')),
    'viewer', jsonb_build_object('email', v_email, 'kind', v_kind, 'level', v_m.level::text),
    'link', jsonb_build_object(
      'id', v_l.id,
      'label', v_l.label,
      'authorityLevel', v_l.authority_level,
      'hideEmails', v_l.hide_emails,
      'createdAt', to_char(v_l.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'expiresAt', to_char(v_l.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'callCount', v_l.call_count
    ),
    'library', jsonb_build_object(
      'version', v_lib.version,
      'releasedOn', case when v_lib.released_on is null then null else to_char(v_lib.released_on, 'YYYY-MM-DD') end,
      'reviewer', null,
      'reviewedOn', null
    ),
    'counts', v_warning,
    'verbs', jsonb_build_object(
      'level1', case when v_l.authority_level = 1 then to_jsonb(public.dpdp__ai_level1_verbs()) else '[]'::jsonb end,
      'level2', to_jsonb(public.dpdp__ai_level2_verbs())
    )
  );
end
$$;

-- GET /jobs with filters: { part: 1-7, status: open|done|late|na|due_today,
-- late: true, today: true (required by today's law), mine: true, nobody:
-- true }. Unknown keys are ignored. Returns the whole filtered list; the
-- Edge Function paginates.
create or replace function public.dpdp_ai_link_jobs(p_token text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_part integer;
  v_status text;
  v_out jsonb;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  if jsonb_typeof(v_f) <> 'object' then
    raise exception 'filters must be a JSON object' using errcode = '22023';
  end if;
  if v_f ? 'part' then
    begin
      v_part := (v_f ->> 'part')::integer;
    exception when others then
      raise exception 'part must be a number from 1 to 7' using errcode = '22023';
    end;
    if v_part < 1 or v_part > 7 then
      raise exception 'part must be a number from 1 to 7' using errcode = '22023';
    end if;
  end if;
  v_status := lower(nullif(trim(coalesce(v_f ->> 'status', '')), ''));
  if v_status is not null and v_status not in ('open', 'done', 'late', 'na', 'due_today') then
    raise exception 'status must be one of open, done, late, na, due_today' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(public.dpdp__ai_job_json(r) order by r.template_key), '[]'::jsonb)
  into v_out
  from public.dpdp__ai_link_job_rows(v_l) r
  where (v_part is null or r.part = v_part)
    and (v_status is null
         or (v_status = 'open' and not r.yes and not r.na)
         or (v_status = 'done' and r.yes)
         or (v_status = 'late' and r.late)
         or (v_status = 'na' and r.na)
         or (v_status = 'due_today' and r.status = 'due today'))
    and (not coalesce((v_f ->> 'late')::boolean, false) or r.late)
    and (not coalesce((v_f ->> 'today')::boolean, false) or r."requiredToday")
    and (not coalesce((v_f ->> 'mine')::boolean, false) or r."byIsYou")
    and (not coalesce((v_f ->> 'nobody')::boolean, false) or (r.by is null and not r."isGroup"));
  return v_out;
end
$$;

-- GET /jobs/{id}: one job, in full -- the row, the library's plain text and
-- proof kind, the person, emails sent for it (Monday emails that carried
-- it: dpdp.email_action_token rows), this link's Level 1 actions on it,
-- and the history lines that name it. A job outside the link's view is
-- "not one this link can see" (P0002), never a different message.
create or replace function public.dpdp_ai_link_job(p_token text, p_job_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_email text;
  v_row dpdp.ai_job_row;
  v_t dpdp.obligation_template;
  v_o dpdp.obligation;
  v_sent integer;
  v_actions jsonb;
  v_history jsonb;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select r.* into v_row from public.dpdp__ai_link_job_rows(v_l) r where r.id = p_job_id;
  if v_row.id is null then
    raise exception 'That job does not exist, or is not one this link can see' using errcode = 'P0002';
  end if;
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  select o.* into v_o from dpdp.obligation o where o.id = v_row.id;
  select t.* into v_t from dpdp.obligation_template t where t.id = v_o.template_id;
  select count(*) into v_sent from dpdp.email_action_token e where e.obligation_id = v_o.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'verb', a.verb, 'value', a.value,
    'appliedAt', to_char(a.applied_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'undoableUntil', to_char(a.undoable_until, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'undoneAt', case when a.undone_at is null then null else to_char(a.undone_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end
  ) order by a.applied_at desc), '[]'::jsonb)
  into v_actions
  from dpdp.ai_action a
  where a.obligation_id = v_o.id and a.org_id = v_m.org_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'kind', e.kind,
    'summary', case when v_l.hide_emails then public.dpdp__ai_mask_emails(e.summary, v_email) else e.summary end,
    'detail', case when v_l.hide_emails then public.dpdp__ai_mask_emails(e.detail, v_email) else e.detail end,
    'actorLabel', case when v_l.hide_emails then public.dpdp__ai_mask_emails(e.actor_label, v_email) else e.actor_label end,
    'occurredAt', to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by e.occurred_at desc), '[]'::jsonb)
  into v_history
  from (
    select ev.* from dpdp.event ev
    where ev.org_id = v_m.org_id and position('"' || v_t.name || '"' in ev.summary) > 0
    order by ev.occurred_at desc
    limit 100
  ) e;

  return public.dpdp__ai_job_json(v_row) || jsonb_build_object(
    'plainText', v_t.plain_text,
    'sectionRef', v_t.section_ref,
    'proofKind', v_t.proof_kind::text,
    'roleTag', v_t.role_tag,
    'templateKey', v_t.key,
    'naReason', v_o.na_reason,
    'closedAt', case when v_o.closed_at is null then null else to_char(v_o.closed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'emailsSent', v_sent,
    'aiActions', v_actions,
    'history', v_history
  );
end
$$;

-- GET /law/{code}: the in-force fact for a law code, from the library
-- data, plus the jobs in THIS view that cite it (scoped by the token, so
-- another org's jobs never appear). The topic text is added by the Edge
-- Function from the shared citation table (see the header).
create or replace function public.dpdp_ai_link_law(p_token text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_code text := trim(coalesce(p_code, ''));
  v_family text;
  v_lib dpdp.library_version;
  v_jobs jsonb;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  if v_code !~ '^[dsag]:' then
    raise exception 'A law code looks like d:§8(9), s:R5(9), a:§29 or g: -- the family letter, a colon, then the section or rule' using errcode = '22023';
  end if;
  v_family := left(v_code, 1);
  select v.* into v_lib from dpdp.library_version v where v.is_current = true limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'what', r.what, 'part', r.part, 'status', r.status, 'by', r.by, 'due', to_char(r.due, 'YYYY-MM-DD')) order by r.template_key), '[]'::jsonb)
  into v_jobs
  from public.dpdp__ai_link_job_rows(v_l) r
  where v_code = any(coalesce(r."lawCodes", '{}'::text[]));
  return jsonb_build_object(
    'code', v_code,
    'family', v_family,
    'inForceToday', v_family in ('s', 'a'),
    'inForceFrom', case when v_family = 'd' then '2027-05-13' else null end,
    'inForceUntil', case when v_family = 's' then '2027-05-13' else null end,
    'legalDuty', v_family <> 'g',
    'libraryVersion', v_lib.version,
    'jobs', v_jobs
  );
end
$$;

-- GET /report/{summary|by-person|by-law|by-part}: structured JSON; the
-- Edge Function renders md / csv. Every report is over the link's own
-- rows and nothing else.
create or replace function public.dpdp_ai_link_report(p_token text, p_kind text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_org dpdp.organisation;
  v_m dpdp.membership;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_head jsonb;
  v_body jsonb;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  if v_kind not in ('summary', 'by-person', 'by-law', 'by-part') then
    raise exception 'report must be one of summary, by-person, by-law, by-part' using errcode = '22023';
  end if;
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;
  select o.* into v_org from dpdp.organisation o where o.id = v_m.org_id;
  v_head := jsonb_build_object(
    'kind', v_kind,
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name),
    'generatedAt', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'asOf', to_char((clock_timestamp() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')
  );

  if v_kind = 'summary' then
    select jsonb_build_object(
      'total', count(*) filter (where not r.na),
      'done', count(*) filter (where r.yes and not r.na),
      'open', count(*) filter (where not r.yes and not r.na),
      'late', count(*) filter (where r.late),
      'dueToday', count(*) filter (where r.status = 'due today'),
      'notApplicable', count(*) filter (where r.na),
      'requiredToday', jsonb_build_object(
        'total', count(*) filter (where r."requiredToday" and not r.na),
        'done', count(*) filter (where r."requiredToday" and r.yes and not r.na),
        'late', count(*) filter (where r."requiredToday" and r.late)
      ),
      'nobody', count(*) filter (where r.by is null and not r."isGroup" and not r.na and not r.yes),
      'byPart', (
        select coalesce(jsonb_agg(p order by (p ->> 'part')::integer), '[]'::jsonb) from (
          select jsonb_build_object(
            'part', r2.part,
            'total', count(*) filter (where not r2.na),
            'done', count(*) filter (where r2.yes and not r2.na),
            'late', count(*) filter (where r2.late)
          ) as p
          from public.dpdp__ai_link_job_rows(v_l) r2 group by r2.part
        ) parts
      )
    )
    into v_body
    from public.dpdp__ai_link_job_rows(v_l) r;
    return v_head || jsonb_build_object('summary', v_body);
  end if;

  if v_kind = 'by-person' then
    select coalesce(jsonb_agg(g order by (g ->> 'late')::integer desc, (g ->> 'open')::integer desc, g ->> 'who'), '[]'::jsonb)
    into v_body
    from (
      select jsonb_build_object(
        'who', coalesce(r.by, 'nobody yet'),
        'isGroup', bool_or(r."isGroup"),
        'isYou', bool_or(r."byIsYou"),
        'total', count(*) filter (where not r.na),
        'done', count(*) filter (where r.yes and not r.na),
        'open', count(*) filter (where not r.yes and not r.na),
        'late', count(*) filter (where r.late),
        'lateJobs', coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'what', r.what, 'due', to_char(r.due, 'YYYY-MM-DD'), 'daysLate', r."daysLate", 'lawCodes', to_jsonb(r."lawCodes")) order by r."daysLate" desc) filter (where r.late), '[]'::jsonb)
      ) as g
      from public.dpdp__ai_link_job_rows(v_l) r
      group by coalesce(r.by, 'nobody yet')
    ) groups;
    return v_head || jsonb_build_object('people', v_body);
  end if;

  if v_kind = 'by-law' then
    select coalesce(jsonb_agg(g order by g ->> 'code'), '[]'::jsonb)
    into v_body
    from (
      select jsonb_build_object(
        'code', c.code,
        'family', left(c.code, 1),
        'inForceToday', left(c.code, 1) in ('s', 'a'),
        'total', count(*) filter (where not r.na),
        'done', count(*) filter (where r.yes and not r.na),
        'open', count(*) filter (where not r.yes and not r.na),
        'late', count(*) filter (where r.late),
        'jobs', jsonb_agg(jsonb_build_object('id', r.id, 'what', r.what, 'status', r.status) order by r.template_key)
      ) as g
      from public.dpdp__ai_link_job_rows(v_l) r
      cross join lateral unnest(coalesce(r."lawCodes", '{}'::text[])) as c(code)
      group by c.code
    ) groups;
    return v_head || jsonb_build_object('laws', v_body);
  end if;

  -- by-part
  select coalesce(jsonb_agg(g order by (g ->> 'part')::integer), '[]'::jsonb)
  into v_body
  from (
    select jsonb_build_object(
      'part', r.part,
      'total', count(*) filter (where not r.na),
      'done', count(*) filter (where r.yes and not r.na),
      'open', count(*) filter (where not r.yes and not r.na),
      'late', count(*) filter (where r.late),
      'notApplicable', count(*) filter (where r.na),
      'complete', (count(*) filter (where not r.yes and not r.na)) = 0,
      'jobs', jsonb_agg(jsonb_build_object('id', r.id, 'what', r.what, 'by', r.by, 'due', to_char(r.due, 'YYYY-MM-DD'), 'status', r.status) order by r.template_key)
    ) as g
    from public.dpdp__ai_link_job_rows(v_l) r
    group by r.part
  ) groups;
  return v_head || jsonb_build_object('parts', v_body);
end
$$;

-- GET /history: the org's append-only change log, newest first, at most
-- 500 entries (the Edge Function paginates). Owner, coordinator,
-- grievance officer and CA see the org's whole history (dpdp_org_history's
-- rule); a staff or parent viewer sees only the lines they acted or that
-- name one of their own jobs. hide_emails masks every other person's
-- address in the text.
create or replace function public.dpdp_ai_link_history(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_email text;
  v_kind text;
  v_names text[];
  v_out jsonb;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  v_kind := public.dpdp__viewer_kind(v_m.id);
  if v_kind in ('staff', 'parent') then
    select coalesce(array_agg('"' || r.what || '"'), '{}'::text[]) into v_names from public.dpdp__ai_link_job_rows(v_l) r;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'kind', e.kind,
    'summary', case when v_l.hide_emails then public.dpdp__ai_mask_emails(e.summary, v_email) else e.summary end,
    'detail', case when v_l.hide_emails then public.dpdp__ai_mask_emails(e.detail, v_email) else e.detail end,
    'actorLabel', case when v_l.hide_emails then public.dpdp__ai_mask_emails(e.actor_label, v_email) else e.actor_label end,
    'occurredAt', to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by e.occurred_at desc), '[]'::jsonb)
  into v_out
  from (
    select ev.* from dpdp.event ev
    where ev.org_id = v_m.org_id
      and (v_kind not in ('staff', 'parent')
           or ev.actor_identity_id = v_m.identity_id
           or exists (select 1 from unnest(v_names) n where position(n in ev.summary) > 0))
    order by ev.occurred_at desc
    limit 500
  ) e;
  return v_out;
end
$$;

-- POST /actions -- Level 1 only, and only when the link was made with it
-- switched on. Applies ONE of NOTE / SET_DUE / ASSIGN / MARK_NA under the
-- link's own person's authority (the same rules their own page applies:
-- SET_DUE and ASSIGN are the owner's; MARK_NA is the owner's or the
-- assignee's; NOTE is anyone's), records "by <person> via AI assistant" in
-- history, flags it for the person's next Monday email, and returns an
-- undo token good for 24 hours. Every Level 2 verb is refused here for
-- every link -- they are drafts, always (POST /drafts).
create or replace function public.dpdp_ai_link_action(p_token text, p_verb text, p_job_id text, p_value jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_email text;
  v_verb text := upper(trim(coalesce(p_verb, '')));
  v_value jsonb := coalesce(p_value, '{}'::jsonb);
  v_row dpdp.ai_job_row;
  v_o dpdp.obligation;
  v_name text;
  v_target_email text;
  v_target_identity text;
  v_prev_email text;
  v_previous jsonb;
  v_what text;
  v_detail text;
  v_undo text;
  v_undo_hash text;
  v_id text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_l := public.dpdp__ai_link_for_token(p_token);

  if v_verb = any(public.dpdp__ai_level2_verbs()) then
    raise exception '% has legal weight -- an AI link can never do it directly, at any level. POST /drafts instead: the person confirms it in their own browser.', v_verb
      using errcode = '42501';
  end if;
  if v_verb <> all(public.dpdp__ai_level1_verbs()) then
    raise exception '"%" is not an action. Level 1 actions are NOTE, SET_DUE, ASSIGN and MARK_NA.', coalesce(p_verb, '') using errcode = '22023';
  end if;
  if v_l.authority_level <> 1 then
    raise exception 'This link is read-only (Level 0). Ask the person to make a Level 1 link, or send a draft (POST /drafts) for them to confirm.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_value) <> 'object' then
    raise exception 'value must be a JSON object' using errcode = '22023';
  end if;
  if length(v_value::text) > 4000 then
    raise exception 'value is too long (4000 characters at most)' using errcode = '22023';
  end if;

  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;

  if p_job_id is null then
    raise exception 'job_id is required -- use an id from GET /jobs' using errcode = '22023';
  end if;
  select r.* into v_row from public.dpdp__ai_link_job_rows(v_l) r where r.id = p_job_id;
  if v_row.id is null then
    raise exception 'That job does not exist, or is not one this link can see' using errcode = '22023';
  end if;
  select o.* into v_o from dpdp.obligation o where o.id = v_row.id;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  v_name := coalesce(v_name, 'a job');

  case v_verb
    when 'NOTE' then
      if trim(coalesce(v_value ->> 'text', '')) = '' then
        raise exception 'NOTE needs value.text' using errcode = '22023';
      end if;
      if length(v_value ->> 'text') > 1000 then
        raise exception 'NOTE text is too long (1000 characters at most)' using errcode = '22023';
      end if;
      v_previous := '{}'::jsonb;
      v_what := 'added a note to "' || v_name || '"';
      v_detail := left(v_value ->> 'text', 1000);

    when 'SET_DUE' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can change when a job is due' using errcode = '42501';
      end if;
      if coalesce(v_value ->> 'dueOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'SET_DUE needs value.dueOn as a date, YYYY-MM-DD' using errcode = '22023';
      end if;
      begin
        perform (v_value ->> 'dueOn')::date;
      exception when others then
        raise exception 'SET_DUE needs value.dueOn as a real date, YYYY-MM-DD' using errcode = '22023';
      end;
      if v_o.state in ('closed', 'submitted', 'not_applicable') then
        raise exception 'That job is already % -- its due date cannot change', replace(v_o.state, '_', ' ') using errcode = 'P0001';
      end if;
      v_previous := jsonb_build_object('dueOn', to_char(v_o.due_on, 'YYYY-MM-DD'));
      update dpdp.obligation set due_on = (v_value ->> 'dueOn')::date where id = v_o.id;
      v_what := 'set "' || v_name || '" due on ' || (v_value ->> 'dueOn') || ' (was ' || to_char(v_o.due_on, 'YYYY-MM-DD') || ')';

    when 'ASSIGN' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can give a job to someone' using errcode = '42501';
      end if;
      if v_o.assigned_staff_group_id is not null then
        raise exception 'That job belongs to a group -- it cannot be given to one person from an AI link' using errcode = '22023';
      end if;
      if v_o.state in ('closed', 'submitted') then
        raise exception 'That job is already done -- it cannot be given to someone else' using errcode = 'P0001';
      end if;
      if v_o.state = 'not_applicable' then
        raise exception 'That job is marked not applicable -- it cannot be given to someone' using errcode = 'P0001';
      end if;
      v_target_email := lower(trim(coalesce(v_value ->> 'email', '')));
      if position('@' in v_target_email) = 0 then
        raise exception 'ASSIGN needs value.email -- the email of an existing member of this organisation' using errcode = '22023';
      end if;
      -- Existing members ONLY (WO-013 §1.2): no identity or membership is
      -- ever created from an AI link. Adding a person is a Level 2 draft.
      select m2.identity_id into v_target_identity
      from dpdp.membership m2
      join dpdp.identity_email ie on ie.identity_id = m2.identity_id
      where m2.org_id = v_m.org_id and m2.state = 'active' and lower(ie.email) = v_target_email
      order by ie.is_primary desc
      limit 1;
      if v_target_identity is null then
        raise exception '% is not a member of this organisation. An AI link can only give a job to an existing member -- to add someone, POST /drafts with ADD_PERSON for the owner to confirm.', v_target_email
          using errcode = '22023';
      end if;
      select i.primary_email into v_prev_email from dpdp.identity i where i.id = v_o.assigned_person_id;
      v_previous := jsonb_build_object('assignedPersonId', v_o.assigned_person_id, 'assignedEmail', v_prev_email, 'state', v_o.state);
      update dpdp.obligation set assigned_person_id = v_target_identity, state = 'open' where id = v_o.id;
      v_what := 'gave "' || v_name || '" to ' || v_target_email || case when v_prev_email is not null then ' (was ' || v_prev_email || ')' else '' end;

    when 'MARK_NA' then
      if v_o.assigned_person_id is distinct from v_m.identity_id and v_m.level <> 'owner' then
        raise exception 'Not your job -- only the owner or the person it is assigned to can mark it not applicable' using errcode = '42501';
      end if;
      if trim(coalesce(v_value ->> 'reason', '')) = '' then
        raise exception 'Marking something not applicable needs a written reason.' using errcode = '22023';
      end if;
      if length(v_value ->> 'reason') > 1000 then
        raise exception 'MARK_NA reason is too long (1000 characters at most)' using errcode = '22023';
      end if;
      if v_o.state = 'not_applicable' then
        raise exception 'That job is already marked not applicable' using errcode = 'P0001';
      end if;
      v_previous := jsonb_build_object('state', v_o.state, 'naReason', v_o.na_reason);
      -- 0605 dpdp_mark_not_applicable's write, verbatim (it cannot be called
      -- here: it reads the caller's JWT, and this call has none).
      update dpdp.obligation set state = 'not_applicable', na_reason = left(trim(v_value ->> 'reason'), 1000) where id = v_o.id;
      v_what := 'marked "' || v_name || '" as not applicable';
      v_detail := left(trim(v_value ->> 'reason'), 1000);

    else
      raise exception 'Unknown verb' using errcode = '22023';
  end case;

  v_undo := encode(extensions.gen_random_bytes(32), 'hex');
  v_undo_hash := encode(sha256(convert_to(v_undo, 'UTF8')), 'hex');
  v_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.ai_action (id, link_id, membership_id, org_id, verb, obligation_id, value, previous, applied_at, undoable_until, undo_token_hash)
  values (v_id, v_l.id, v_m.id, v_m.org_id, v_verb, v_o.id, v_value, v_previous, v_now, v_now + interval '24 hours', v_undo_hash);

  perform public.dpdp__append_event(
    v_m.org_id, v_m.identity_id, v_email, 'ai_action_applied',
    'by ' || v_email || ' via AI assistant -- ' || v_what,
    v_detail
  );

  return jsonb_build_object(
    'actionId', v_id,
    'verb', v_verb,
    'jobId', v_o.id,
    'appliedAt', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'undoableUntil', to_char(v_now + interval '24 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'undoToken', v_undo,
    'recorded', 'by ' || v_email || ' via AI assistant -- ' || v_what
  );
end
$$;

-- POST /drafts -- Level 2 (and, for compatibility, the five 0607 verbs).
-- Writes ONE dpdp.ai_draft row and nothing else. Some verbs need a job
-- (MARK_DONE, DELETE, REMOVE_PERSON, ADD_PERSON, CHANGE_SIGNER, and the
-- 0607 job verbs); OWNER_CONFIRM, MANAGER_CHECK, PARTNER_SIGN, PUBLISH and
-- EXPORT_PERSONAL_DATA may stand alone. The confirm screen
-- (dpdp_confirm_ai_draft below) says which of these it can execute today.
create or replace function public.dpdp_ai_link_draft(p_token text, p_verb text, p_job_id text default null, p_value jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_verb text := upper(trim(coalesce(p_verb, '')));
  v_value jsonb := coalesce(p_value, '{}'::jsonb);
  v_row dpdp.ai_job_row;
  v_o dpdp.obligation;
  v_needs_job boolean;
  v_confirm text;
  v_confirm_hash text;
  v_id text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp := (clock_timestamp() at time zone 'UTC') + interval '48 hours';
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;

  if v_verb <> all(public.dpdp__ai_level2_verbs()) and v_verb not in ('ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA', 'DRAFT') then
    raise exception '"%" is not something an AI link may draft. Level 2 verbs: %.', coalesce(p_verb, ''), array_to_string(public.dpdp__ai_level2_verbs(), ', ')
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_value) <> 'object' then
    raise exception 'value must be a JSON object' using errcode = '22023';
  end if;
  if length(v_value::text) > 4000 then
    raise exception 'value is too long (4000 characters at most)' using errcode = '22023';
  end if;

  v_needs_job := v_verb in ('MARK_DONE', 'DELETE', 'REMOVE_PERSON', 'ADD_PERSON', 'CHANGE_SIGNER', 'ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA');
  if v_needs_job and p_job_id is null then
    raise exception 'job_id is required for % -- use an id from GET /jobs', v_verb using errcode = '22023';
  end if;
  if p_job_id is not null then
    select r.* into v_row from public.dpdp__ai_link_job_rows(v_l) r where r.id = p_job_id;
    if v_row.id is null then
      raise exception 'That job does not exist, or is not one this link can see' using errcode = '22023';
    end if;
    select o.* into v_o from dpdp.obligation o where o.id = v_row.id;
  end if;

  -- The shapes the confirm step needs, checked now so the AI can fix them.
  if v_verb in ('ADD_PERSON', 'ASSIGN', 'CHANGE_SIGNER') and position('@' in coalesce(v_value ->> 'email', '')) = 0 then
    raise exception '% needs value.email', v_verb using errcode = '22023';
  end if;
  if v_verb = 'SET_DUE' and coalesce(v_value ->> 'dueOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'SET_DUE needs value.dueOn as a date, YYYY-MM-DD' using errcode = '22023';
  end if;
  if v_verb = 'NOTE' and trim(coalesce(v_value ->> 'text', '')) = '' then
    raise exception 'NOTE needs value.text' using errcode = '22023';
  end if;
  if v_verb = 'MARK_NA' and trim(coalesce(v_value ->> 'reason', '')) = '' then
    raise exception 'Marking something not applicable needs a written reason.' using errcode = '22023';
  end if;
  if v_verb in ('DELETE', 'REMOVE_PERSON') and trim(coalesce(v_value ->> 'reason', '')) = '' then
    raise exception '% needs value.reason -- the person confirming must see why', v_verb using errcode = '22023';
  end if;

  v_confirm := encode(extensions.gen_random_bytes(32), 'hex');
  v_confirm_hash := encode(sha256(convert_to(v_confirm, 'UTF8')), 'hex');
  v_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.ai_draft (id, ai_link_id, membership_id, org_id, verb, obligation_id, payload, created_at, expires_at, confirm_token_hash)
  values (v_id, v_l.id, v_m.id, v_m.org_id, v_verb, v_o.id, v_value, v_now, v_expires, v_confirm_hash);

  return jsonb_build_object(
    'draftId', v_id,
    'confirmToken', v_confirm,
    'verb', v_verb,
    'jobId', v_o.id,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'executableOnConfirm', v_verb in ('ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA', 'DRAFT', 'MARK_DONE', 'OWNER_CONFIRM', 'ADD_PERSON')
  );
end
$$;

-- ---------------------------------------------------------------------
-- 5. The Monday digest hook (service_role): the Level 1 actions a
--    membership's next email should list. p_mark = true stamps them as
--    shown. The digest builder (0606) is not rewritten -- the email
--    function calls this per membership.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_timer_ai_actions_for_digest(p_membership_id text, p_mark boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_out jsonb;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'actionId', a.id,
    'verb', a.verb,
    'jobId', a.obligation_id,
    'what', (select t.name from dpdp.obligation o join dpdp.obligation_template t on t.id = o.template_id where o.id = a.obligation_id),
    'value', a.value,
    'appliedAt', to_char(a.applied_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'undoableUntil', to_char(a.undoable_until, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'stillUndoable', (a.undone_at is null and a.undoable_until > v_now),
    'undoneAt', case when a.undone_at is null then null else to_char(a.undone_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end
  ) order by a.applied_at desc), '[]'::jsonb)
  into v_out
  from dpdp.ai_action a
  where a.membership_id = p_membership_id and a.digest_pending;
  if coalesce(p_mark, false) then
    update dpdp.ai_action set digest_pending = false, digested_at = v_now
    where membership_id = p_membership_id and digest_pending;
  end if;
  return v_out;
end
$$;

-- A fresh undo token for the Monday email (the one returned at apply time
-- went to the AI's caller; only its hash is kept). Replaces the hash --
-- the earlier token stops working -- and only while the action is still
-- undoable.
create or replace function public.dpdp_timer_issue_undo_token(p_action_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a dpdp.ai_action;
  v_undo text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select a.* into v_a from dpdp.ai_action a where a.id = p_action_id;
  if v_a.id is null or v_a.undone_at is not null or v_a.undoable_until <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'not undoable');
  end if;
  v_undo := encode(extensions.gen_random_bytes(32), 'hex');
  update dpdp.ai_action set undo_token_hash = encode(sha256(convert_to(v_undo, 'UTF8')), 'hex') where id = v_a.id;
  return jsonb_build_object('ok', true, 'actionId', v_a.id, 'undoToken', v_undo, 'undoableUntil', to_char(v_a.undoable_until, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end
$$;

-- ---------------------------------------------------------------------
-- 6. Re-created 0607 functions (same signature, same shape).
-- ---------------------------------------------------------------------

-- dpdp_ai_link_read (the GET /snapshot page): as 0607, now honouring
-- hide_emails and reporting the link's level. Kept so the snapshot page
-- and every 0607 test keep working.
create or replace function public.dpdp_ai_link_read(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_org dpdp.organisation;
  v_email text;
  v_kind text;
  v_rows jsonb;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;

  update dpdp.ai_link set read_count = read_count + 1, last_read_at = v_now where id = v_l.id;

  select o.* into v_org from dpdp.organisation o where o.id = v_m.org_id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  v_kind := public.dpdp__viewer_kind(v_m.id);

  -- 0607's shape (0604's ObligationRow), with `by` already masked by the
  -- row builder when hide_emails is on.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'part', r.part, 'what', r.what, 'dataSet', r."dataSet",
    'dataTypes', to_jsonb(r."dataTypes"), 'lawCodes', to_jsonb(r."lawCodes"),
    'by', r.by, 'isGroup', r."isGroup", 'groupDone', r."groupDone", 'groupTotal', r."groupTotal",
    'viewerIsGroupMember', case when r."isGroup" then exists (
      select 1 from dpdp.obligation o join dpdp.staff_group_member sgm on sgm.group_id = o.assigned_staff_group_id
      where o.id = r.id and sgm.membership_id = v_m.id
    ) end,
    'myGroupAnswer', case when r."isGroup" then (
      select a.answer::text from dpdp.obligation_group_answer a where a.obligation_id = r.id and a.membership_id = v_m.id
    ) end,
    'due', to_char(r.due, 'YYYY-MM-DD'), 'yes', r.yes, 'na', r.na,
    'dependsOnObligationId', r."dependsOnObligationId", 'sent', 0
  ) order by r.template_key), '[]'::jsonb)
  into v_rows
  from public.dpdp__ai_link_job_rows(v_l) r;

  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'product', coalesce(v_org.product, 'firm')),
    'viewer', jsonb_build_object('email', v_email, 'kind', v_kind),
    'link', jsonb_build_object(
      'id', v_l.id,
      'expiresAt', to_char(v_l.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'readCount', v_l.read_count + 1,
      'authorityLevel', v_l.authority_level,
      'hideEmails', v_l.hide_emails
    ),
    'verbs', jsonb_build_array('ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA', 'DRAFT'),
    'rows', v_rows
  );
end
$$;

-- dpdp_confirm_ai_draft: 0607's body, plus the Level 2 verbs. Executable
-- today, under the signed-in person's own authority and the same RPCs
-- their page uses:
--   MARK_DONE     -> public.dpdp_mark_done (0604; it reads the caller's
--                    JWT, which inside this call is the person's own)
--   OWNER_CONFIRM -> public.dpdp_owner_confirm_setup (0609)
--   ADD_PERSON    -> the ASSIGN path (find-or-create identity + membership,
--                    assign the job; owner only)
-- Not executable yet -- refused with a plain sentence, the draft stays
-- unconfirmed and nothing changes: MANAGER_CHECK, PARTNER_SIGN, DELETE,
-- REMOVE_PERSON, CHANGE_SIGNER, PUBLISH, EXPORT_PERSONAL_DATA (no RPC
-- exists for them on the Supabase path today).
create or replace function public.dpdp_confirm_ai_draft(p_draft_id text, p_confirm_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d dpdp.ai_draft;
  v_m dpdp.membership;
  v_email text;
  v_o dpdp.obligation;
  v_name text;
  v_target_email text;
  v_target_identity text;
  v_what text;
  v_detail text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select d.* into v_d from dpdp.ai_draft d where d.id = p_draft_id;
  if v_d.id is null or v_d.confirm_token_hash <> encode(sha256(convert_to(left(coalesce(p_confirm_token, ''), 256), 'UTF8')), 'hex') then
    raise exception 'This draft link is not valid' using errcode = '42501';
  end if;
  v_m := public.dpdp__caller_membership(v_d.org_id);
  if v_m.id is null or v_m.id <> v_d.membership_id then
    raise exception 'This draft was made from someone else''s AI link -- only they can confirm it' using errcode = '42501';
  end if;
  if v_d.confirmed_at is not null then
    raise exception 'This draft has already been confirmed' using errcode = 'P0001';
  end if;
  if v_d.expires_at <= v_now then
    raise exception 'This draft has expired -- ask the AI for a fresh one' using errcode = 'P0001';
  end if;

  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;

  if v_d.obligation_id is not null then
    select o.* into v_o from dpdp.obligation o where o.id = v_d.obligation_id and o.org_id = v_d.org_id;
    if v_o.id is null then
      raise exception 'Job not found' using errcode = 'P0002';
    end if;
    select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  end if;
  v_name := coalesce(v_name, 'a job');

  case v_d.verb
    when 'ASSIGN', 'ADD_PERSON' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can give a job to someone' using errcode = '42501';
      end if;
      v_target_email := lower(trim(coalesce(v_d.payload ->> 'email', '')));
      if position('@' in v_target_email) = 0 then
        raise exception 'ASSIGN needs payload.email' using errcode = '22023';
      end if;
      select ie.identity_id into v_target_identity
      from dpdp.identity_email ie
      where lower(ie.email) = v_target_email
      order by ie.is_primary desc
      limit 1;
      if v_target_identity is null then
        v_target_identity := replace(gen_random_uuid()::text, '-', '');
        insert into dpdp.identity (id, primary_email, created_at) values (v_target_identity, v_target_email, v_now);
        insert into dpdp.identity_email (id, identity_id, email, is_primary)
        values (replace(gen_random_uuid()::text, '-', ''), v_target_identity, v_target_email, true);
      end if;
      if not exists (select 1 from dpdp.membership m where m.identity_id = v_target_identity and m.org_id = v_d.org_id) then
        insert into dpdp.membership (id, identity_id, org_id, level, joined_via, created_at)
        values (replace(gen_random_uuid()::text, '-', ''), v_target_identity, v_d.org_id, 'staff', 'named_in_role', v_now);
      end if;
      update dpdp.obligation set assigned_person_id = v_target_identity where id = v_o.id;
      v_what := 'gave "' || v_name || '" to ' || v_target_email;

    when 'SET_DUE' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can change when a job is due' using errcode = '42501';
      end if;
      update dpdp.obligation set due_on = (v_d.payload ->> 'dueOn')::date where id = v_o.id;
      v_what := 'set "' || v_name || '" due on ' || (v_d.payload ->> 'dueOn');

    when 'NOTE' then
      v_what := 'added a note to "' || v_name || '"';
      v_detail := left(v_d.payload ->> 'text', 1000);

    when 'MARK_NA' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can mark a job as not applicable' using errcode = '42501';
      end if;
      update dpdp.obligation set state = 'not_applicable', na_reason = left(v_d.payload ->> 'reason', 1000) where id = v_o.id;
      v_what := 'marked "' || v_name || '" as not applicable';
      v_detail := left(v_d.payload ->> 'reason', 1000);

    when 'DRAFT' then
      v_what := 'drafted ' || coalesce(nullif(left(v_d.payload ->> 'docKind', 80), ''), 'a document')
        || case when v_d.obligation_id is not null then ' for "' || v_name || '"' else '' end;
      v_detail := left(v_d.payload ->> 'text', 1000);

    when 'MARK_DONE' then
      perform public.dpdp_mark_done(v_o.id);
      v_what := 'marked "' || v_name || '" done';

    when 'OWNER_CONFIRM' then
      perform public.dpdp_owner_confirm_setup(v_d.org_id);
      v_what := 'confirmed the list their CA set up';

    else
      raise exception 'A % draft cannot be confirmed here yet -- do it on your page. Nothing has changed.', v_d.verb using errcode = 'P0001';
  end case;

  update dpdp.ai_draft set confirmed_at = v_now, confirmed_by = v_m.identity_id where id = v_d.id;

  perform public.dpdp__append_event(
    v_d.org_id, v_m.identity_id, v_email, 'ai_draft_confirmed',
    'drafted by AI, confirmed by ' || v_email || ' -- ' || v_what,
    v_detail
  );

  return jsonb_build_object('ok', true, 'verb', v_d.verb, 'obligationId', v_d.obligation_id);
end
$$;

-- ---------------------------------------------------------------------
-- 7. Grants. Helpers: nobody. Browser surface: authenticated (+ app_runtime
--    for the DB-gated tests, as 0604/0607). Edge Function surface:
--    service_role only (+ app_runtime for the tests) -- revoked from
--    authenticated too, so a signed-in browser cannot read someone else's
--    link by token.
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__ai_level1_verbs() from public, anon, authenticated;
revoke all on function public.dpdp__ai_level2_verbs() from public, anon, authenticated;
revoke all on function public.dpdp__ai_mask_emails(text, text) from public, anon, authenticated;
revoke all on function public.dpdp__ai_link_job_rows(dpdp.ai_link) from public, anon, authenticated;
revoke all on function public.dpdp__ai_job_json(dpdp.ai_job_row) from public, anon, authenticated;
revoke all on function public.dpdp__ai_link_warning_for(text) from public, anon, authenticated;
revoke all on function dpdp.ai_link_call_guard() from public, anon, authenticated;

revoke all on function public.dpdp_ai_link_warning(text) from public, anon;
revoke all on function public.dpdp_ai_link_create(integer, boolean, integer, text, text) from public, anon;
revoke all on function public.dpdp_ai_link_list(text) from public, anon;
revoke all on function public.dpdp_ai_link_revoke(text) from public, anon;
revoke all on function public.dpdp_ai_action_undo(text, text) from public, anon;
revoke all on function public.dpdp_confirm_ai_draft(text, text) from public, anon;
grant execute on function public.dpdp_ai_link_warning(text) to authenticated, app_runtime;
grant execute on function public.dpdp_ai_link_create(integer, boolean, integer, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_ai_link_list(text) to authenticated, app_runtime;
grant execute on function public.dpdp_ai_link_revoke(text) to authenticated, app_runtime;
grant execute on function public.dpdp_ai_action_undo(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_confirm_ai_draft(text, text) to authenticated, app_runtime;

revoke all on function public.dpdp_ai_link_log_call(text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_log_call_result(text, integer, integer) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_context(text) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_jobs(text, jsonb) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_job(text, text) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_law(text, text) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_report(text, text) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_history(text) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_draft(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_read(text) from public, anon, authenticated;
revoke all on function public.dpdp_timer_ai_actions_for_digest(text, boolean) from public, anon, authenticated;
revoke all on function public.dpdp_timer_issue_undo_token(text) from public, anon, authenticated;
grant execute on function public.dpdp_ai_link_log_call(text, text, text) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_log_call_result(text, integer, integer) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_context(text) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_jobs(text, jsonb) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_job(text, text) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_law(text, text) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_report(text, text) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_history(text) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_action(text, text, text, jsonb) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_draft(text, text, text, jsonb) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_read(text) to service_role, app_runtime;
grant execute on function public.dpdp_timer_ai_actions_for_digest(text, boolean) to service_role, app_runtime;
grant execute on function public.dpdp_timer_issue_undo_token(text) to service_role, app_runtime;
