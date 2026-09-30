-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-30 -- "in email itself give the AI WORK LINK ... user should in most cases never open the webpage" and "ITS NOT read-only 7-day AI Work link. ITS READ / EDIT / WORK". Authorizes the GRANT/REVOKE/SECURITY DEFINER statements below (a hardening of the emailed link the owner asked for, made after an independent three-reviewer pass); applied to the live database by the session that wrote it, under this instruction, via the Supabase Management API.
--
-- DPDP: hardening of the AI work link that the Monday email carries (follows 0663). Findings of the review, and what this file does:
--
--   1. LIMITS FOR AN EMAILED LINK. A link the Monday email carried (label 'Monday email') was never chosen by the person, and it sits in
--      a mailbox, in forwards and in quoted replies. It stays level 1 (read + the four small edits, drafts for the rest -- the owner's
--      READ / EDIT / WORK), but dpdp_ai_link_action now refuses two things for such a link, and only such a link:
--        * SET_DUE outside the window [today - 30 days, today + 400 days];
--        * MARK_NA on a job required by today's law (that is a draft the person confirms).
--      A link the person makes themselves in the app is untouched. The refusals say to send a draft instead. Everything else in
--      dpdp_ai_link_action is the live definition, unchanged.
--   2. RETIRE LAST WEEK'S LINK ONLY AFTER THIS WEEK'S EMAIL WENT. 0663 retired the previous emailed link at mint time, so a failed
--      send left the person with no working link. dpdp_timer_mint_email_ai_link no longer revokes anything and no longer writes an
--      audit event (it was attributed to the person, added one event per recipient per week and pushed real events out of the
--      500-line history an AI reads). dpdp_timer_finish_email_ai_link does it after the send: delivered = true retires every OTHER
--      live 'Monday email' link of that person; delivered = false retires the link that was never delivered.
--   3. dpdp_timer_ai_actions_mark_shown marks exactly the changes that were LISTED in the email (by id), not everything pending, so a
--      change made while the email was being sent is still reported next time.
--   4. dpdp.event gets the index its per-organisation "latest hash" lookup always needed (org_id, occurred_at desc).
--
-- All functions are service_role only. Nothing is dropped.

-- 1. The live dpdp_ai_link_action, plus the two limits for an emailed link (marked '0664').
CREATE OR REPLACE FUNCTION public.dpdp_ai_link_action(p_token text, p_verb text, p_job_id text, p_value jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- 0664: a link that the Monday email carried (label 'Monday email') was never chosen by the person, so it gets tighter limits.
      if v_l.label = 'Monday email'
         and ((v_value ->> 'dueOn')::date < (v_now::date - 30) or (v_value ->> 'dueOn')::date > (v_now::date + 400)) then
        raise exception 'A link sent by email can only move a due date to between 30 days ago and 400 days ahead. Send a draft (POST /drafts) for anything else.' using errcode = '22023';
      end if;
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
      -- 0664: same reason. A job required by today's law leaves the escalation ladder only when the person confirms it.
      if v_l.label = 'Monday email' and v_row."requiredToday" then
        raise exception 'This job is required by today''s law, so marking it not applicable needs the person''s own confirmation. A link sent by email can only draft it: POST /drafts with MARK_NA.' using errcode = '42501';
      end if;
      if v_o.state = 'not_applicable' then
        raise exception 'That job is already marked not applicable' using errcode = 'P0001';
      end if;
      v_previous := jsonb_build_object('state', v_o.state, 'naReason', v_o.na_reason);
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
$function$;

-- 2. Mint: creates the row and returns the token once; retires nothing, writes no event.
create or replace function public.dpdp_timer_mint_email_ai_link(
  p_membership_id text,
  p_level integer default 1,
  p_days integer default 7
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_token text;
  v_hash text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
  v_id text;
  v_level integer := coalesce(p_level, 1);
  v_days integer := coalesce(p_days, 7);
  v_warning jsonb;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_membership_id and m.state = 'active';
  if v_m.id is null then
    raise exception 'No active membership %', p_membership_id using errcode = 'P0002';
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
    v_level, false, v_m.id, 'Monday email', 0
  );

  v_warning := public.dpdp__ai_link_warning_for(v_m.id);
  return jsonb_build_object(
    'linkId', v_id,
    'token', v_token,
    'level', v_level,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'jobs', v_warning -> 'jobs',
    'people', v_warning -> 'people'
  );
end
$$;

-- 3. After the send. delivered = true: every OTHER live 'Monday email' link of this person stops working. delivered = false: the link
--    that never reached anyone stops working (the previous one is still live). Never touches a link with another label.
create or replace function public.dpdp_timer_finish_email_ai_link(
  p_membership_id text,
  p_link_id text,
  p_delivered boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_n integer;
begin
  if coalesce(p_delivered, false) then
    update dpdp.ai_link
    set revoked_at = v_now
    where membership_id = p_membership_id and label = 'Monday email' and revoked_at is null and id <> p_link_id;
  else
    update dpdp.ai_link
    set revoked_at = v_now
    where membership_id = p_membership_id and label = 'Monday email' and revoked_at is null and id = p_link_id;
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_n);
end
$$;

-- 4. Mark exactly the changes that were listed in the email as shown.
create or replace function public.dpdp_timer_ai_actions_mark_shown(
  p_membership_id text,
  p_action_ids text[]
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_n integer;
begin
  update dpdp.ai_action
  set digest_pending = false, digested_at = v_now
  where membership_id = p_membership_id and digest_pending and id = any (coalesce(p_action_ids, '{}'::text[]));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'marked', v_n);
end
$$;

-- 5. The lookup dpdp__append_event runs for every event of an organisation.
create index if not exists dpdp_event_org_occurred_idx on dpdp.event (org_id, occurred_at desc);

revoke all on function public.dpdp_timer_mint_email_ai_link(text, integer, integer) from public, anon, authenticated;
revoke all on function public.dpdp_timer_finish_email_ai_link(text, text, boolean) from public, anon, authenticated;
revoke all on function public.dpdp_timer_ai_actions_mark_shown(text, text[]) from public, anon, authenticated;
grant execute on function public.dpdp_timer_mint_email_ai_link(text, integer, integer) to service_role;
grant execute on function public.dpdp_timer_finish_email_ai_link(text, text, boolean) to service_role;
grant execute on function public.dpdp_timer_ai_actions_mark_shown(text, text[]) to service_role;
