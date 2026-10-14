-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7, fix 14: consent_token.token and org_invite.code were stored and matched in plain text). Applied by the project manager.
--
-- 1. dpdp.consent_token.token (18 rows): the link a person receives is a bearer secret. Only its SHA-256 (token_hash) is kept now. Every existing row is converted
--    in this migration (so links already sent keep working: the person's link hashes to the stored value), the plain column is emptied, and a trigger turns any
--    plain token an older writer inserts into a hash on the way in. The four functions that look a token up (preview, answer, answer v2, withdraw) match by hash.
-- 2. dpdp.org_invite.code (572 rows): the organisation's join code must still be SHOWN to its owner (the invite link, the Monday e-mail), so it is stored
--    ENCRYPTED with the same Vault key as the partner payout details (dpdp.payout_enc, drizzle/0723), and matched through code_hash, a keyed HMAC-SHA256 of the
--    upper-cased code (a plain hash of an 8-character code could be guessed offline). A trigger encrypts and hashes any plain code written, so the generators
--    and every other writer are unchanged; the readers decrypt (dpdp_my_org_invite_link, the Monday digest). Joining matches by hash.
-- Needs the Vault secret dpdp_payout_key (it exists since 0723); refuses to run without it.
-- Roll-back: drizzle/down/0763_dpdp_hash_consent_token_and_invite_code.down.sql (decrypts the invite codes back and restores their readers; consent tokens cannot be
-- un-hashed, so the hash lookups stay: a link already sent keeps working).

do $$
begin
  if (select count(*) from vault.decrypted_secrets where name = 'dpdp_payout_key' and length(decrypted_secret) >= 32) = 0 then
    raise exception 'The Vault secret dpdp_payout_key (at least 32 characters) is needed before applying this migration' using errcode = '55000';
  end if;
end
$$;

create or replace function dpdp.token_sha256(p_plain text)
returns text
language sql immutable
set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p_plain, ''), 'UTF8')), 'hex') $$;

create or replace function dpdp.invite_code_hash(p_code text)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  return encode(extensions.hmac(convert_to(upper(btrim(coalesce(p_code, ''))), 'UTF8'), convert_to(dpdp.payout_key(), 'UTF8'), 'sha256'), 'hex');
end
$$;
revoke all on function dpdp.invite_code_hash(text), dpdp.token_sha256(text) from public, anon, authenticated;

-- ---- consent_token ----
alter table dpdp.consent_token add column if not exists token_hash text;
update dpdp.consent_token set token_hash = dpdp.token_sha256(token) where token_hash is null and token is not null;
alter table dpdp.consent_token alter column token drop not null;
update dpdp.consent_token set token = null where token is not null and token_hash is not null;
create unique index if not exists consent_token_token_hash_key on dpdp.consent_token (token_hash);

create or replace function dpdp.consent_token_protect()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.token is not null then
    new.token_hash := dpdp.token_sha256(new.token);
    new.token := null;
  end if;
  return new;
end
$$;
drop trigger if exists consent_token_protect on dpdp.consent_token;
create trigger consent_token_protect before insert or update of token on dpdp.consent_token for each row execute function dpdp.consent_token_protect();

-- ---- org_invite ----
alter table dpdp.org_invite add column if not exists code_hash text;

create or replace function dpdp.org_invite_protect()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.code is not null and left(new.code, 5) <> 'enc1:' then
    new.code_hash := dpdp.invite_code_hash(new.code);
    new.code := dpdp.payout_enc(new.code);
  end if;
  return new;
end
$$;
drop trigger if exists org_invite_protect on dpdp.org_invite;
create trigger org_invite_protect before insert or update of code on dpdp.org_invite for each row execute function dpdp.org_invite_protect();

update dpdp.org_invite set code = code where left(code, 5) <> 'enc1:';
create unique index if not exists org_invite_code_hash_key on dpdp.org_invite (code_hash);

-- ---- readers and lookups (the live definitions, with only the marked lookups changed) ----
CREATE OR REPLACE FUNCTION public.dpdp_parent_consent_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_n dpdp.notice_version;
  v_org text;
  v_notice jsonb;
  v_purposes jsonb;
begin
  select t.* into v_t from dpdp.consent_token t where t.token_hash = dpdp.token_sha256(coalesce(p_token, ''));
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  select c.* into v_c from dpdp.consent_campaign c where c.id = v_t.campaign_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  -- An expired link can no longer be used to GIVE consent, but it can still show the person their answers and withdraw them.
  if v_t.expires_at < (clock_timestamp() at time zone 'UTC') and v_t.acted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  select n.* into v_n from dpdp.notice_version n where n.id = v_c.notice_version_id;
  select o.name into v_org from dpdp.organisation o where o.id = v_c.org_id;
  if v_t.opened_at is null then
    update dpdp.consent_token set opened_at = (clock_timestamp() at time zone 'UTC') where id = v_t.id;
  end if;
  v_notice := dpdp.consent_notice_text(v_c, v_org);
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', p ->> 'key', 'label', p ->> 'label',
    'answer', (select case when r.granted and r.withdrawn_at is null then 'yes'
                           when exists (select 1 from dpdp.consent_record g where g.token_id = v_t.id and g.purpose_key = r.purpose_key and g.granted and g.recorded_at <= r.recorded_at and g.id <> r.id) then 'withdrawn'
                           else 'no' end
                 from dpdp.consent_record r where r.token_id = v_t.id and r.purpose_key = p ->> 'key' order by r.recorded_at desc, r.id desc limit 1)
  )), '[]'::jsonb) into v_purposes from jsonb_array_elements(dpdp.consent_purposes(v_c)) p;
  return jsonb_build_object(
    'ok', true,
    'orgName', v_org,
    'notice', case when v_n.id is null then null else jsonb_build_object('docKind', v_n.doc_kind, 'version', v_n.version, 'languages', to_jsonb(v_n.languages)) end,
    'openedAt', v_t.opened_at,
    'actedAt', v_t.acted_at,
    'alreadyAnswered', (v_t.acted_at is not null),
    'noticeText', v_notice ->> 'text',
    'noticeSource', v_notice ->> 'source',
    'purposes', v_purposes,
    'principalIsChild', v_c.principal_is_child,
    'guardian', case when v_t.guardian_name is null then null else jsonb_build_object('name', v_t.guardian_name, 'relation', v_t.guardian_relation) end,
    'canWithdraw', (v_t.acted_at is not null)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.dpdp_parent_consent(p_token text, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_granted boolean;
begin
  if p_answer is null or p_answer not in ('yes', 'no') then
    return jsonb_build_object('ok', false, 'reason', 'That is not an answer this link can record.');
  end if;
  select t.* into v_t from dpdp.consent_token t where t.token_hash = dpdp.token_sha256(coalesce(p_token, ''));
  if v_t.id is null or v_t.expires_at < v_now then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  select c.* into v_c from dpdp.consent_campaign c where c.id = v_t.campaign_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  if v_t.acted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'This link has already been used. Nothing has changed.');
  end if;
  v_granted := (p_answer = 'yes');
  insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id, language, recorded_at, withdrawn_at)
  values (replace(gen_random_uuid()::text, '-', ''), v_t.id, 'consent', v_granted, v_c.notice_version_id, 'en', v_now, case when v_granted then null else v_now end);
  update dpdp.consent_token set acted_at = v_now, opened_at = coalesce(opened_at, v_now) where id = v_t.id;
  perform public.dpdp__append_event(v_c.org_id, null, 'A person on a link', 'consent_recorded', 'Recorded 1 answer(s)');
  return jsonb_build_object('ok', true, 'answer', p_answer);
end
$function$;

CREATE OR REPLACE FUNCTION public.dpdp_parent_consent_v2(p_token text, p_answers jsonb, p_guardian jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_p jsonb;
  v_key text;
  v_ans text;
  v_gname text := nullif(btrim(regexp_replace(coalesce(p_guardian ->> 'name', ''), '\s+', ' ', 'g')), '');
  v_grel text := lower(btrim(coalesce(p_guardian ->> 'relation', '')));
  v_n integer := 0;
begin
  select t.* into v_t from dpdp.consent_token t where t.token_hash = dpdp.token_sha256(coalesce(p_token, ''));
  if v_t.id is null or v_t.expires_at < v_now then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  select c.* into v_c from dpdp.consent_campaign c where c.id = v_t.campaign_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  if v_t.acted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'This link has already been used. Nothing has changed.');
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'That is not an answer this link can record.');
  end if;
  -- every purpose answered, nothing extra, each yes or no
  for v_p in select * from jsonb_array_elements(dpdp.consent_purposes(v_c)) loop
    v_key := v_p ->> 'key';
    v_ans := p_answers ->> v_key;
    if v_ans is null or v_ans not in ('yes', 'no') then
      return jsonb_build_object('ok', false, 'reason', 'Please answer Yes or No for each item.');
    end if;
    v_n := v_n + 1;
  end loop;
  if (select count(*) from jsonb_object_keys(p_answers)) <> v_n then
    return jsonb_build_object('ok', false, 'reason', 'That is not an answer this link can record.');
  end if;
  if v_c.principal_is_child then
    if v_gname is null or v_gname !~ '^[A-Za-zऀ-ॿ][A-Za-zऀ-ॿ .''-]{1,79}$' then
      return jsonb_build_object('ok', false, 'reason', 'Please give the name of the parent or legal guardian answering for the child.');
    end if;
    if v_grel not in ('parent', 'legal_guardian') then
      return jsonb_build_object('ok', false, 'reason', 'Please say whether you are the parent or the legal guardian.');
    end if;
  end if;
  for v_p in select * from jsonb_array_elements(dpdp.consent_purposes(v_c)) loop
    v_key := v_p ->> 'key';
    insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id, language, recorded_at, withdrawn_at)
    values (replace(gen_random_uuid()::text, '-', ''), v_t.id, v_key, (p_answers ->> v_key) = 'yes', v_c.notice_version_id, 'en', v_now,
            case when (p_answers ->> v_key) = 'yes' then null else v_now end);
  end loop;
  update dpdp.consent_token
     set acted_at = v_now, opened_at = coalesce(opened_at, v_now),
         guardian_name = case when v_c.principal_is_child then v_gname else null end,
         guardian_relation = case when v_c.principal_is_child then v_grel else null end,
         guardian_recorded_at = case when v_c.principal_is_child then v_now else null end
   where id = v_t.id;
  perform public.dpdp__append_event(v_c.org_id, null, 'A person on a link', 'consent_recorded', 'Recorded ' || v_n || ' answer(s)');
  return jsonb_build_object('ok', true, 'recorded', v_n);
end
$function$;

CREATE OR REPLACE FUNCTION public.dpdp_consent_withdraw(p_token text, p_purpose_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_last dpdp.consent_record;
begin
  select t.* into v_t from dpdp.consent_token t where t.token_hash = dpdp.token_sha256(coalesce(p_token, ''));
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid.');
  end if;
  select c.* into v_c from dpdp.consent_campaign c where c.id = v_t.campaign_id;
  if v_c.id is null or v_t.acted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'There is nothing to withdraw yet.');
  end if;
  if not exists (select 1 from jsonb_array_elements(dpdp.consent_purposes(v_c)) p where p ->> 'key' = coalesce(p_purpose_key, '')) then
    return jsonb_build_object('ok', false, 'reason', 'That is not one of the items on this link.');
  end if;
  select r.* into v_last from dpdp.consent_record r where r.token_id = v_t.id and r.purpose_key = p_purpose_key order by r.recorded_at desc, r.id desc limit 1;
  if v_last.id is null or not v_last.granted or v_last.withdrawn_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'There is nothing to withdraw for this item.');
  end if;
  insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id, language, recorded_at, withdrawn_at)
  values (replace(gen_random_uuid()::text, '-', ''), v_t.id, p_purpose_key, false, v_c.notice_version_id, v_last.language, v_now, v_now);
  perform public.dpdp__append_event(v_c.org_id, null, 'A person on a link', 'consent_withdrawn', 'Withdrew consent for 1 item');
  return jsonb_build_object('ok', true, 'withdrawn', p_purpose_key);
end
$function$;

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
      dpdp.payout_dec(oi.code) as "inviteCode", -- WO-016 STEP 2
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

  select dpdp.payout_dec(oi.code) into v_code from dpdp.org_invite oi where oi.org_id = v_m.org_id;
  if v_code is not null then
    return jsonb_build_object('code', v_code);
  end if;

  loop
    v_try := v_try + 1;
    v_code := '';
    for v_i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from dpdp.org_invite oi where oi.code_hash = dpdp.invite_code_hash(v_code));
    if v_try >= 10 then
      raise exception 'Could not generate an invite link, try again' using errcode = 'P0001';
    end if;
  end loop;

  insert into dpdp.org_invite (org_id, code) values (v_m.org_id, v_code)
  on conflict (org_id) do nothing;
  -- A concurrent first call may have won the insert: read back whichever code stuck.
  select dpdp.payout_dec(oi.code) into v_code from dpdp.org_invite oi where oi.org_id = v_m.org_id;

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

  select oi.org_id into v_org_id from dpdp.org_invite oi where oi.code_hash = dpdp.invite_code_hash(v_code);
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
      exit when not exists (select 1 from dpdp.org_invite oi where oi.code_hash = dpdp.invite_code_hash(v_code));
      exit when v_try >= 10;
    end loop;
    if v_try < 10 then
      insert into dpdp.org_invite (org_id, code) values (p_org_id, v_code) on conflict (org_id) do nothing;
    end if;
  end if;
end
$function$;
