-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-30 -- "Do this task here: 'Wire assign / not-applicable / due-date / note controls into the DPDP one-page app'". Authorizes the SECURITY DEFINER functions and the GRANT/REVOKE statements below (two new page RPCs, one hardening of an existing one) for the owner's and assignee's own page; applied to the live database by the session that wrote it, under this instruction, via the Supabase Management API.
--
-- DPDP one-page app: the person's own page gets the four controls it lacked (owner, 2026-09-30). The backend already had two of them
-- (dpdp_assign_person, dpdp_mark_not_applicable, drizzle/0605) that no component called; a due date and a note had no browser RPC at all, so they
-- happened only through an AI work link. This file adds the two missing RPCs and closes gaps in three existing ones.
--
--   1. public.dpdp_set_due_date(p_obligation_id, p_due_on)   OWNER only. Same sanity window the page form and dpdp__ai_link_job_rows use: from 30
--      days ago to 400 days ahead, INDIA time. A finished job (closed, or submitted -- the page counts both as Yes) or a not-applicable job is
--      refused (its date no longer matters). One event, kind obligation_due_changed. Nothing else changes: an assignee keeps the job, and Monday's
--      email simply reads the new date (it recomputes "days late" from the stored date).
--   2. public.dpdp_add_note(p_obligation_id, p_text)         ANY member who can SEE the job, by the page's own visibility rule (owner, coordinator,
--      Grievance Officer and CA see the whole organisation; a staff member or parent sees their own jobs and the group jobs they are in). 1..1000
--      characters, trimmed of spaces, tabs and line breaks. One event, kind obligation_note_added, summary 'Added a note to "<job>"' and the text as
--      its detail. (An AI link's NOTE files its own kind, ai_action_applied, with a "via AI assistant" summary; both put the words in `detail`.)
--      The history is append-only: a note cannot be edited or removed.
--   3. public.dpdp_mark_not_applicable(...) is re-created as 0605 wrote it EXCEPT: a finished job (closed or submitted) is refused with "Already
--      closed" -- until now the page RPC would have flipped a finished job to "not applicable" and silently dropped a real Yes from the counts;
--      the reason may be at most 1000 characters (the page form and the AI link already cap it; a direct call did not, and the reason lands in the
--      append-only, hash-chained history); and the job row is locked while it is checked, so a Yes recorded a moment earlier cannot be overwritten.
--      A job already "not applicable" stays idempotent.
--   4. public.dpdp_assign_person(...) is re-created as 0605 wrote it EXCEPT: `submitted` is refused like `closed` (it used to be put back to
--      'open', undoing a Yes), and the row is locked while it is checked.
--   5. public.dpdp_org_history(...) is re-created as 0605 wrote it EXCEPT: a staff member or a parent gets only the entries THEY made. The page
--      never asks for History as staff, but the function answered anyone signed in, and a note (or a reason for "doesn't apply") is now free text
--      that can concern a job the staff member cannot see. Owner, coordinator, Grievance Officer and CA still get the whole organisation.
--
-- Same rules as 0604/0605: public schema, SECURITY DEFINER, search_path = '', caller resolved from the Supabase Auth JWT's email through
-- public.dpdp__caller_identity_id() / public.dpdp__caller_membership(); a job the caller cannot see is "Job not found", never a message that would
-- confirm the id exists; every write appends exactly one dpdp.event through public.dpdp__append_event in the same transaction. Additive: no table
-- changes.

-- ---------------------------------------------------------------------
-- 1. Change a job's due date. Owner only.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_set_due_date(p_obligation_id text, p_due_on date)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_name text;
  v_today date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
begin
  v_identity := public.dpdp__caller_identity_id();
  -- for update: the state checked below is the state written over; a Yes recorded a moment earlier waits, then is seen.
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id for update;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if p_due_on is null then
    raise exception 'A date is required' using errcode = '22023';
  end if;
  if v_o.state in ('closed', 'submitted') then
    raise exception 'Already closed' using errcode = 'P0001';
  end if;
  if v_o.state = 'not_applicable' then
    raise exception 'Doesn''t apply' using errcode = 'P0001';
  end if;
  if p_due_on < v_today - 30 or p_due_on > v_today + 400 then
    raise exception 'Pick a date from % to %', to_char(v_today - 30, 'YYYY-MM-DD'), to_char(v_today + 400, 'YYYY-MM-DD') using errcode = '22023';
  end if;

  update dpdp.obligation set due_on = p_due_on where id = v_o.id;

  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(
    v_o.org_id, v_identity, v_label, 'obligation_due_changed',
    'Set "' || coalesce(v_name, 'a job') || '" due on ' || to_char(p_due_on, 'YYYY-MM-DD'),
    'It was due on ' || coalesce(to_char(v_o.due_on, 'YYYY-MM-DD'), 'no date')
  );
  return jsonb_build_object('ok', true, 'dueOn', to_char(p_due_on, 'YYYY-MM-DD'));
end
$$;

-- ---------------------------------------------------------------------
-- 2. Add a note to a job. Any member who can see the job.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_add_note(p_obligation_id text, p_text text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_text text := btrim(coalesce(p_text, ''), E' \t\r\n');
  v_name text;
  v_kind text;
  v_sees boolean;
begin
  v_identity := public.dpdp__caller_identity_id();
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  -- The page's own visibility rule (dpdp__ai_link_job_rows / dpdp_my_page): owner, coordinator, Grievance Officer and CA see the whole
  -- organisation; a staff member or parent sees the jobs given to them and the group jobs they are in. Anything else is "not found".
  v_kind := public.dpdp__viewer_kind(v_m.id);
  -- coalesce: an unassigned job has a null assigned_person_id, and `false or null or false` is null, which `if not` would treat as "no refusal".
  v_sees := coalesce(v_kind not in ('staff', 'parent'), false)
    or coalesce(v_o.assigned_person_id = v_identity, false)
    or coalesce(v_o.assigned_staff_group_id is not null and exists (
      select 1 from dpdp.staff_group_member sgm where sgm.group_id = v_o.assigned_staff_group_id and sgm.membership_id = v_m.id
    ), false);
  if not v_sees then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_text = '' then
    raise exception 'A note needs some words' using errcode = '22023';
  end if;
  if length(v_text) > 1000 then
    raise exception 'A note can be 1000 characters at most' using errcode = '22023';
  end if;

  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(v_o.org_id, v_identity, v_label, 'obligation_note_added', 'Added a note to "' || coalesce(v_name, 'a job') || '"', v_text);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 3. "Doesn't apply": identical to 0605's body, plus a finished job is refused.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_mark_not_applicable(p_obligation_id text, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\r\n'), '');
  v_name text;
begin
  v_identity := public.dpdp__caller_identity_id();
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id for update;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_o.assigned_person_id is distinct from v_identity and v_m.level <> 'owner' then
    raise exception 'Not your job' using errcode = '42501';
  end if;
  if v_o.state in ('closed', 'submitted') then
    raise exception 'Already closed' using errcode = 'P0001';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'A reason can be 1000 characters at most' using errcode = '22023';
  end if;

  update dpdp.obligation
  set state = 'not_applicable', na_reason = coalesce(v_reason, 'Marked ‘doesn’t apply’')
  where id = v_o.id;

  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(v_o.org_id, v_identity, v_label, 'obligation_not_my_job', 'Marked "' || coalesce(v_name, 'a job') || '" as not applicable', v_reason);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 4. Give a job to someone: 0605's body, plus `submitted` is refused like `closed`, and the row is locked while it is checked.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_assign_person(p_obligation_id text, p_email text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_addr text := lower(trim(coalesce(p_email, '')));
  v_person text;
  v_name text;
begin
  v_identity := public.dpdp__caller_identity_id();
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id for update;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if v_addr = '' then
    raise exception 'An email address is required' using errcode = '22023';
  end if;
  if v_o.state in ('closed', 'submitted') then
    raise exception 'Already closed' using errcode = 'P0001';
  end if;
  if v_o.state = 'not_applicable' then
    raise exception 'Doesn''t apply' using errcode = 'P0001';
  end if;

  v_person := public.dpdp__find_or_create_identity(v_addr);
  perform public.dpdp__find_or_create_membership(v_o.org_id, v_person);
  update dpdp.obligation set assigned_person_id = v_person, state = 'open' where id = v_o.id;

  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(v_o.org_id, v_identity, v_label, 'obligation_assigned', 'Assigned "' || coalesce(v_name, 'a job') || '" to ' || v_addr);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 5. History: 0605's body, plus a staff member or a parent reads only the entries they made themselves.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_org_history(p_org_id text default null, p_limit int default 15)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_limit int := greatest(least(coalesce(p_limit, 15), 50), 1);
  v_out jsonb;
  v_kind text;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  v_kind := public.dpdp__viewer_kind(v_m.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'kind', e.kind,
    'summary', e.summary,
    'detail', e.detail,
    'actorLabel', e.actor_label,
    'occurredAt', to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by e.occurred_at desc), '[]'::jsonb)
  into v_out
  from (
    select ev.*
    from dpdp.event ev
    where ev.org_id = v_m.org_id
      -- a staff member or parent reads only what they did themselves (the same rule dpdp_ai_link_history applies)
      and (coalesce(v_kind, 'staff') not in ('staff', 'parent') or ev.actor_identity_id = v_m.identity_id)
    order by ev.occurred_at desc
    limit v_limit
  ) e;
  return v_out;
end
$$;

-- Grants: identical policy to 0605 -- the browser (authenticated, after a magic link) and app_runtime (the DB-gated tests), never anon.
revoke all on function public.dpdp_set_due_date(text, date) from public, anon;
revoke all on function public.dpdp_add_note(text, text) from public, anon;
grant execute on function public.dpdp_set_due_date(text, date) to authenticated, app_runtime;
grant execute on function public.dpdp_add_note(text, text) to authenticated, app_runtime;
-- dpdp_mark_not_applicable, dpdp_assign_person and dpdp_org_history were re-created above: CREATE OR REPLACE keeps their privileges; restating them is belt and braces.
revoke all on function public.dpdp_mark_not_applicable(text, text) from public, anon;
grant execute on function public.dpdp_mark_not_applicable(text, text) to authenticated, app_runtime;
revoke all on function public.dpdp_assign_person(text, text) from public, anon;
grant execute on function public.dpdp_assign_person(text, text) to authenticated, app_runtime;
revoke all on function public.dpdp_org_history(text, int) from public, anon;
grant execute on function public.dpdp_org_history(text, int) to authenticated, app_runtime;
