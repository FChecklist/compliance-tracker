-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-30 -- "Do this task here: 'Wire assign / not-applicable / due-date / note controls into the DPDP one-page app'". Authorizes the SECURITY DEFINER functions and the GRANT/REVOKE statements below (two new page RPCs, one hardening of an existing one) for the owner's and assignee's own page; applied to the live database by the session that wrote it, under this instruction, via the Supabase Management API.
--
-- DPDP one-page app: the person's own page gets the four controls it lacked (owner, 2026-09-30). The backend already had two of them
-- (dpdp_assign_person, dpdp_mark_not_applicable, drizzle/0605) that no component called; a due date and a note had no browser RPC at all, so they
-- happened only through an AI work link. This file adds the two missing RPCs and closes one gap in an existing one.
--
--   1. public.dpdp_set_due_date(p_obligation_id, p_due_on)   OWNER only. Same sanity window the AI link uses for an emailed link (0664): from 30
--      days ago to 400 days ahead, India time. A closed or not-applicable job is refused (its date no longer matters). One event, kind
--      obligation_due_changed. Nothing else changes: an assignee keeps the job, and Monday's email simply reads the new date.
--   2. public.dpdp_add_note(p_obligation_id, p_text)         ANY member who can SEE the job, by the page's own visibility rule (owner, coordinator,
--      Grievance Officer and CA see the whole organisation; a staff member or parent sees their own jobs and the group jobs they are in). 1..1000
--      characters, trimmed. One event, kind obligation_note_added, summary 'Added a note to "<job>"' and the text as its detail -- the same shape an
--      AI link's NOTE writes, so an AI reading the job's history sees it. The history is append-only: a note cannot be edited or removed.
--   3. public.dpdp_mark_not_applicable(...) is re-created identically EXCEPT that a job that is already Yes (closed) is refused with "Already
--      closed". Until now the page RPC would have flipped a finished job to "not applicable" and silently dropped a real Yes from the counts; the AI
--      link's own action and dpdp_assign_person both already refuse a closed job. A job already "not applicable" stays idempotent.
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
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id;
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
  if v_o.state = 'closed' then
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
  v_text text := trim(coalesce(p_text, ''));
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
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_name text;
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
  if v_o.assigned_person_id is distinct from v_identity and v_m.level <> 'owner' then
    raise exception 'Not your job' using errcode = '42501';
  end if;
  if v_o.state = 'closed' then
    raise exception 'Already closed' using errcode = 'P0001';
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

-- Grants: identical policy to 0605 -- the browser (authenticated, after a magic link) and app_runtime (the DB-gated tests), never anon.
revoke all on function public.dpdp_set_due_date(text, date) from public, anon;
revoke all on function public.dpdp_add_note(text, text) from public, anon;
grant execute on function public.dpdp_set_due_date(text, date) to authenticated, app_runtime;
grant execute on function public.dpdp_add_note(text, text) to authenticated, app_runtime;
-- dpdp_mark_not_applicable(text, text) was re-created above: CREATE OR REPLACE keeps its privileges; restating them is belt and braces.
revoke all on function public.dpdp_mark_not_applicable(text, text) from public, anon;
grant execute on function public.dpdp_mark_not_applicable(text, text) to authenticated, app_runtime;
