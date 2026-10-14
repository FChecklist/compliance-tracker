-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7). Roll-back file for 0763_dpdp_hash_consent_token_and_invite_code.sql; it is not run unless the project manager decides to undo that migration.
-- Decrypts the organisations' join codes back to plain text and restores their readers. Consent tokens cannot be un-hashed: their hash lookups stay in place, so a link
-- already sent keeps working (new links are still hashed by the trigger).
drop trigger if exists org_invite_protect on dpdp.org_invite;
update dpdp.org_invite set code = dpdp.payout_dec(code) where left(code, 5) = 'enc1:';
drop index if exists dpdp.org_invite_code_hash_key;
alter table dpdp.org_invite drop column if exists code_hash;
drop function if exists dpdp.org_invite_protect();

CREATE OR REPLACE FUNCTION dpdp.build_monday_digests(p_now timestamp with time zone DEFAULT now(), p_org_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (p_now at time zone 'Asia/Kolkata')::date;
  v_week text := dpdp.monday_week_key(p_now);
  v_out jsonb;
begin
  with jobs as (
    select
      ob.id, ob.org_id, ob.assigned_person_id, ob.assigned_staff_group_id, ob.due_on, ob.state,
      t.key, t.name, t.part,
      (t.answerable_by = 'processor') as outside_party,
      dpdp.required_today(t.law_codes) as required_today,
      greatest(0, v_today - ob.due_on) as days_late,
      (ob.state = 'stuck' or exists (
        select 1 from dpdp.obligation_group_answer ga where ga.obligation_id = ob.id and ga.answer = 'cannot'
      )) as stuck,
      (select i.primary_email from dpdp.identity i where i.id = ob.assigned_person_id) as assignee_email,
      (select g.label from dpdp.staff_group g where g.id = ob.assigned_staff_group_id) as group_label
    from dpdp.obligation ob
    join dpdp.obligation_template t on t.id = ob.template_id
    where ob.state not in ('not_applicable', 'closed', 'submitted')
      and (p_org_id is null or ob.org_id = p_org_id)
      and not exists (
        select 1 from dpdp.obligation d
        where d.id = ob.depends_on_obligation_id and d.state not in ('closed', 'submitted', 'not_applicable')
      )
  ),
  scored as (
    select j.*,
      (j.days_late > 0) as late,
      case when j.required_today then 7 else 14 end as cc_threshold,
      case when j.required_today then 15 else 30 end as owner_threshold
    from jobs j
  ),
  flagged as (
    select s.*,
      ((s.late and s.days_late >= s.cc_threshold) or s.stuck) as cc_coordinator,
      (s.late and s.days_late >= s.owner_threshold) as owner_named,
      s.stuck as coordinator_now,
      (s.outside_party and s.late) as relationship_owner
    from scored s
  ),
  org_contacts as (
    select o.id as org_id,
      coalesce((
        select jsonb_agg(jsonb_build_object('membershipId', m.id, 'email', i.primary_email) order by m.created_at)
        from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
        where m.org_id = o.id and m.level = 'owner' and m.state = 'active'
      ), '[]'::jsonb) as owners,
      coalesce((
        select jsonb_agg(jsonb_build_object('membershipId', m.id, 'email', i.primary_email) order by m.created_at)
        from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
        where m.org_id = o.id and m.state = 'active' and exists (
          select 1 from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
          where ob.org_id = o.id and ob.assigned_person_id = m.identity_id
            and t.role_tag = 'DPDP coordinator' and ob.state <> 'not_applicable'
        )
      ), '[]'::jsonb) as coordinators
    from dpdp.organisation o
    where p_org_id is null or o.id = p_org_id
  )
  select coalesce(jsonb_agg(to_jsonb(d) order by d."orgId", d."membershipId"), '[]'::jsonb)
  into v_out
  from (
    select
      m.id as "membershipId",
      m.identity_id as "identityId",
      m.org_id as "orgId",
      org.name as "orgName",
      coalesce(org.product, 'firm') as "orgProduct",
      coalesce(sub.state, 'trial') as "subscriptionState", -- WO-016 §9
      ref.code as "referralCode", -- WO-016 STEP 2
      oi.code as "inviteCode", -- WO-016 STEP 2
      i.primary_email as email,
      m.level,
      case when m.level = 'owner' then 'owner' when rc.is_coord then 'coord' else 'staff' end as "roleKind",
      v_week as "weekKey",
      to_char(v_today, 'YYYY-MM-DD') as today,
      (ep.unsubscribed_at is not null) as unsubscribed,
      (ep.unsubscribed_at is not null or coalesce(ep.statutory_only, false)) as "statutoryOnly",
      exists (
        select 1 from dpdp.email_send es
        where es.membership_id = m.id and es.kind in ('monday_digest', 'statutory')
          and es.period_key = v_week and es.status <> 'failed'
      ) as "alreadySentThisWeek",
      c.owners,
      c.coordinators,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
            'obligationId', f.id,
            'key', f.key,
            'what', f.name,
            'part', f.part,
            'dueOn', to_char(f.due_on, 'YYYY-MM-DD'),
            'daysLate', f.days_late,
            'late', f.late,
            'requiredToday', f.required_today,
            'isGroup', (f.assigned_staff_group_id is not null),
            'groupLabel', f.group_label,
            'assigneeEmail', f.assignee_email,
            'isMine', (coalesce(f.assigned_person_id = m.identity_id, false) or coalesce(f.assigned_staff_group_id = any(mg.ids), false)),
            'stuck', f.stuck,
            'outsideParty', f.outside_party,
            'escalation', jsonb_build_object(
              'red', f.late,
              'ccCoordinator', f.cc_coordinator,
              'ownerNamed', f.owner_named,
              'coordinatorNow', f.coordinator_now,
              'relationshipOwner', f.relationship_owner,
              'ccThresholdDays', f.cc_threshold,
              'ownerThresholdDays', f.owner_threshold
            )
          ) order by f.days_late desc, f.due_on asc, f.key asc), '[]'::jsonb)
        from flagged f
        where f.org_id = m.org_id
          and (
            m.level = 'owner'
            or f.assigned_person_id = m.identity_id
            or f.assigned_staff_group_id = any(mg.ids)
          )
          and not (
            coalesce(f.assigned_staff_group_id = any(mg.ids), false)
            and exists (select 1 from dpdp.obligation_group_answer ga where ga.obligation_id = f.id and ga.membership_id = m.id)
          )
      ) as jobs,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
            'obligationId', f.id,
            'what', f.name,
            'assigneeEmail', coalesce(f.assignee_email, f.group_label),
            'daysLate', f.days_late,
            'requiredToday', f.required_today,
            'stuck', f.stuck,
            'outsideParty', f.outside_party,
            'reason', case
              when rc.is_coord and f.coordinator_now then 'stuck'
              when m.level = 'owner' and f.owner_named then 'late_owner'
              when m.level = 'owner' and f.relationship_owner then 'outside_party_silent'
              when rc.is_coord and f.cc_coordinator then 'late_coordinator'
            end
          ) order by f.days_late desc, f.key asc), '[]'::jsonb)
        from flagged f
        where f.org_id = m.org_id
          and f.assigned_person_id is distinct from m.identity_id
          and (
            (m.level = 'owner' and (f.owner_named or f.relationship_owner))
            or (rc.is_coord and (f.cc_coordinator or f.coordinator_now))
          )
      ) as "escalatedToMe"
    from dpdp.membership m
    join dpdp.identity i on i.id = m.identity_id
    join dpdp.organisation org on org.id = m.org_id
    left join dpdp.subscription sub on sub.org_id = m.org_id -- WO-016 §9
    left join dpdp.referral ref on ref.identity_id = m.identity_id -- WO-016 STEP 2
    left join dpdp.org_invite oi on oi.org_id = m.org_id -- WO-016 STEP 2
    join org_contacts c on c.org_id = m.org_id
    left join dpdp.email_preference ep on ep.membership_id = m.id
    cross join lateral (
      select coalesce(array_agg(sgm.group_id), '{}'::text[]) as ids
      from dpdp.staff_group_member sgm where sgm.membership_id = m.id
    ) mg
    cross join lateral (
      select exists (
        select 1 from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
        where ob.org_id = m.org_id and ob.assigned_person_id = m.identity_id
          and t.role_tag = 'DPDP coordinator' and ob.state <> 'not_applicable'
      ) as is_coord
    ) rc
    where m.state = 'active'
      and m.said_not_me_at is null
      and (p_org_id is null or m.org_id = p_org_id)
  ) d;
  return v_out;
end
$function$;

CREATE OR REPLACE FUNCTION public.dpdp_my_org_invite_link(p_org_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_m dpdp.membership;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try int := 0;
  v_i int;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;

  select oi.code into v_code from dpdp.org_invite oi where oi.org_id = v_m.org_id;
  if v_code is not null then
    return jsonb_build_object('code', v_code);
  end if;

  loop
    v_try := v_try + 1;
    v_code := '';
    for v_i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from dpdp.org_invite oi where oi.code = v_code);
    if v_try >= 10 then
      raise exception 'Could not generate an invite link, try again' using errcode = 'P0001';
    end if;
  end loop;

  insert into dpdp.org_invite (org_id, code) values (v_m.org_id, v_code)
  on conflict (org_id) do nothing;
  -- A concurrent first call may have won the insert: read back whichever code stuck.
  select oi.code into v_code from dpdp.org_invite oi where oi.org_id = v_m.org_id;

  return jsonb_build_object('code', v_code);
end
$function$;

CREATE OR REPLACE FUNCTION public.dpdp_join_org_via_invite(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_identity text;
  v_org_id text;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_m dpdp.membership;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_code = '' then
    raise exception 'An invite link is required' using errcode = '22023';
  end if;

  select oi.org_id into v_org_id from dpdp.org_invite oi where upper(oi.code) = v_code;
  if v_org_id is null then
    raise exception 'That invite link is not valid' using errcode = '22023';
  end if;

  v_identity := public.dpdp__find_or_create_identity(v_email);

  select m.* into v_m from dpdp.membership m
  where m.identity_id = v_identity and m.org_id = v_org_id
  order by m.created_at desc limit 1;
  if v_m.id is not null then
    return jsonb_build_object('ok', true, 'orgId', v_org_id, 'membershipId', v_m.id, 'alreadyMember', true);
  end if;

  v_m.id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via)
  values (v_m.id, v_identity, v_org_id, 'staff', 'invited');

  perform public.dpdp__append_event(v_org_id, v_identity, v_email, 'membership_joined', v_email || ' joined via an invite link', 'invited');

  return jsonb_build_object('ok', true, 'orgId', v_org_id, 'membershipId', v_m.id, 'alreadyMember', false);
end
$function$;

CREATE OR REPLACE FUNCTION public.dpdp_timer_ensure_link_codes(p_org_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_try int;
  v_i int;
  v_identity text;
begin
  for v_identity in
    select distinct m.identity_id
    from dpdp.membership m
    where m.org_id = p_org_id and m.state = 'active'
      and not exists (select 1 from dpdp.referral r where r.identity_id = m.identity_id)
  loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      v_code := '';
      for v_i in 1..8 loop
        v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from dpdp.referral r where r.code = v_code);
      exit when v_try >= 10; -- best-effort: this identity gets no code this run, tried again next Monday
    end loop;
    if v_try < 10 then
      insert into dpdp.referral (identity_id, code, consented_at, state)
      values (v_identity, v_code, (clock_timestamp() at time zone 'UTC'), 'active')
      on conflict (identity_id) do nothing;
    end if;
  end loop;

  if not exists (select 1 from dpdp.org_invite oi where oi.org_id = p_org_id) then
    v_try := 0;
    loop
      v_try := v_try + 1;
      v_code := '';
      for v_i in 1..8 loop
        v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from dpdp.org_invite oi where oi.code = v_code);
      exit when v_try >= 10;
    end loop;
    if v_try < 10 then
      insert into dpdp.org_invite (org_id, code) values (p_org_id, v_code) on conflict (org_id) do nothing;
    end if;
  end if;
end
$function$;

drop function if exists dpdp.invite_code_hash(text);
