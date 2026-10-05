-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 3 (consent page: notice text, per-purpose answers, guardian details, withdraw on the same link)
--
-- DPDP compliance programme, Wave 3 (consent). Organisations send consent links exactly as they do today; nothing about creating or sending a campaign
-- or a token changes. Everything here is additive and defaulted, so an existing campaign and an existing link keep behaving as before.
--  * dpdp.notice_version.body_text: the notice's own text, if the organisation has stored it. Absent: the page shows a plain standard notice built from
--    the facts the system has (organisation, purposes, grievance contact, the Board route). noticeSource says which.
--  * dpdp.consent_campaign.purposes (jsonb [{key,label}]; null = the single legacy purpose 'consent') and principal_is_child (default false).
--  * dpdp.consent_token.guardian_name / guardian_relation / guardian_recorded_at: where the person is a child, the parent or legal guardian who answers.
--  * dpdp_parent_consent_preview: the same answer as before plus noticeText, noticeSource, purposes (each with the person's current answer),
--    principalIsChild, guardian, canWithdraw. The original keys are unchanged.
--  * dpdp_parent_consent_v2(token, answers, guardian): one answer PER purpose, guardian name and relationship required when the principal is a child,
--    single use for the granting exactly as before. The original dpdp_parent_consent(token, 'yes'|'no') is unchanged and still works.
--  * dpdp_consent_withdraw(token, purpose_key): withdraws one purpose with the SAME link, with no new link and even after the link's expiry (the link
--    is the person's own receipt: withdrawing must be as easy as giving). A withdrawal is a new row (granted = false, withdrawn_at set), never an edit.
-- Roll-back: drizzle/down/0701_dpdp_consent_page_purposes_guardian_withdraw.down.sql.

alter table dpdp.notice_version add column if not exists body_text text;
alter table dpdp.consent_campaign add column if not exists purposes jsonb;
alter table dpdp.consent_campaign add column if not exists principal_is_child boolean not null default false;
alter table dpdp.consent_token add column if not exists guardian_name text;
alter table dpdp.consent_token add column if not exists guardian_relation text;
alter table dpdp.consent_token add column if not exists guardian_recorded_at timestamp;

-- The purposes of a campaign: the stored list, or the one legacy purpose.
create or replace function dpdp.consent_purposes(p_campaign dpdp.consent_campaign)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when p_campaign.purposes is not null and jsonb_typeof(p_campaign.purposes) = 'array' and jsonb_array_length(p_campaign.purposes) > 0 then p_campaign.purposes
    else '[{"key":"consent","label":"Use of your personal data as described in this notice"}]'::jsonb
  end
$$;

-- The notice text the page shows: the organisation's own text, or a plain standard notice built from what the system knows.
create or replace function dpdp.consent_notice_text(p_campaign dpdp.consent_campaign, p_org_name text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_body text;
  v_contact text;
  v_labels text;
begin
  select n.body_text into v_body from dpdp.notice_version n where n.id = p_campaign.notice_version_id;
  if v_body is not null and btrim(v_body) <> '' then
    return jsonb_build_object('text', v_body, 'source', 'organisation');
  end if;
  select go.email into v_contact from dpdp.grievance_officer go where go.org_id = p_campaign.org_id and go.superseded_at is null order by go.published_since desc nulls last limit 1;
  select string_agg(p ->> 'label', '; ') into v_labels from jsonb_array_elements(dpdp.consent_purposes(p_campaign)) p;
  return jsonb_build_object('source', 'standard', 'text',
    coalesce(p_org_name, 'The organisation') || ' asks for your consent for: ' || coalesce(v_labels, 'the use of your personal data') || '. '
    || 'You may say no to any of it. Saying no does not affect anything else. You can withdraw a Yes at any time, using this same link. '
    || case when v_contact is not null then 'To ask about your data or to make a complaint, write to ' || v_contact || '. ' else 'To ask about your data or to make a complaint, ask ' || coalesce(p_org_name, 'the organisation') || '. ' end
    || 'If you are not satisfied with the answer, you may complain to the Data Protection Board of India.');
end
$$;

revoke all on function dpdp.consent_purposes(dpdp.consent_campaign), dpdp.consent_notice_text(dpdp.consent_campaign, text) from public, anon, authenticated;

-- What the page shows. Same keys as 0609, plus the new ones.
create or replace function public.dpdp_parent_consent_preview(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_n dpdp.notice_version;
  v_org text;
  v_notice jsonb;
  v_purposes jsonb;
begin
  select t.* into v_t from dpdp.consent_token t where t.token = coalesce(p_token, '');
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
$$;

-- One answer per purpose, once.
create or replace function public.dpdp_parent_consent_v2(p_token text, p_answers jsonb, p_guardian jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
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
  select t.* into v_t from dpdp.consent_token t where t.token = coalesce(p_token, '');
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
$$;

-- Withdraw one purpose with the same link. No new link, and the link's expiry does not stop it.
create or replace function public.dpdp_consent_withdraw(p_token text, p_purpose_key text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_last dpdp.consent_record;
begin
  select t.* into v_t from dpdp.consent_token t where t.token = coalesce(p_token, '');
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
$$;

revoke all on function public.dpdp_parent_consent_v2(text, jsonb, jsonb) from public;
revoke all on function public.dpdp_consent_withdraw(text, text) from public;
grant execute on function public.dpdp_parent_consent_v2(text, jsonb, jsonb) to anon, authenticated, service_role, app_runtime;
grant execute on function public.dpdp_consent_withdraw(text, text) to anon, authenticated, service_role, app_runtime;
