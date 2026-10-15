-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-15 (project manager order, owner order to finish the DPDP data-audit items D03, D05, D12, D13, D15) -- own-rights functions and tables; repeat-safe; proved against the live database in a rolled-back transaction before it was applied.
-- DPDP: a person's own rights, built (data audit 2026-10-14: D03, D05, D12, D13, D15).
--   D12 / D05  dpdp_my_data() shows a signed-in person what we hold about them; dpdp_request_my_right('access'|'correction'|'erasure', text) records a request and opens a
--              ticket (class data_request) in the same queue the operator digest already reads, so it is chased like any other data request.
--   D15        dpdp_set_my_nominee(name, email, relation) / dpdp_clear_my_nominee(): the person names someone to exercise their rights if they die or cannot act (section 14).
--   D13        dpdp.erase_person(identity, reason): the operator's single-person erasure. De-identifies the person; keeps what the law or the customer's own record needs.
--   D03        dpdp.consent_record.text_hash: SHA-256 of the exact notice text the person was shown when they answered.
-- Every new table has row level security ON and no grant to anon / authenticated; only the SECURITY DEFINER functions below touch them.

-- ---- D03 -------------------------------------------------------------------------------------------------------------------------------------------------
alter table dpdp.consent_record add column if not exists text_hash text;

create or replace function public.dpdp_parent_consent_v2(p_token text, p_answers jsonb, p_guardian jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_p jsonb;
  v_key text;
  v_ans text;
  v_org text;
  v_hash text;
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
  select o.name into v_org from dpdp.organisation o where o.id = v_c.org_id;
  v_hash := encode(sha256(convert_to(coalesce(dpdp.consent_notice_text(v_c, v_org) ->> 'text', ''), 'UTF8')), 'hex');
  for v_p in select * from jsonb_array_elements(dpdp.consent_purposes(v_c)) loop
    v_key := v_p ->> 'key';
    insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id, language, recorded_at, withdrawn_at, text_hash)
    values (replace(gen_random_uuid()::text, '-', ''), v_t.id, v_key, (p_answers ->> v_key) = 'yes', v_c.notice_version_id, 'en', v_now,
            case when (p_answers ->> v_key) = 'yes' then null else v_now end, v_hash);
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

create or replace function public.dpdp_consent_withdraw(p_token text, p_purpose_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id, language, recorded_at, withdrawn_at, text_hash)
  values (replace(gen_random_uuid()::text, '-', ''), v_t.id, p_purpose_key, false, v_c.notice_version_id, v_last.language, v_now, v_now, v_last.text_hash);
  perform public.dpdp__append_event(v_c.org_id, null, 'A person on a link', 'consent_withdrawn', 'Withdrew consent for 1 item');
  return jsonb_build_object('ok', true, 'withdrawn', p_purpose_key);
end
$$;

-- ---- D05 / D12 / D15 tables ------------------------------------------------------------------------------------------------------------------------------
create table if not exists dpdp.person_request (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  identity_id text not null references dpdp.identity (id),
  kind text not null check (kind in ('access', 'correction', 'erasure')),
  details text check (details is null or char_length(details) <= 2000),
  ticket_no text,
  received_at timestamptz not null default now(),
  due_at timestamptz not null default now() + interval '90 days',
  state text not null default 'open' check (state in ('open', 'done')),
  answered_at timestamptz
);
create index if not exists person_request_identity_idx on dpdp.person_request (identity_id, received_at desc);

create table if not exists dpdp.person_nominee (
  identity_id text primary key references dpdp.identity (id),
  name text not null check (char_length(name) between 2 and 120),
  email text check (email is null or (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  relation text check (relation is null or char_length(relation) <= 60),
  recorded_at timestamptz not null default now()
);

alter table dpdp.person_request enable row level security;
alter table dpdp.person_nominee enable row level security;
revoke all on dpdp.person_request, dpdp.person_nominee from public, anon, authenticated;

-- ---- what we hold (section 11) ------------------------------------------------------------------------------------------------------------------------------
create or replace function public.dpdp_my_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := public.dpdp__caller_identity_id();
begin
  if v_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'identity', (select jsonb_build_object('email', i.primary_email, 'createdAt', i.created_at, 'lastSeenAt', i.last_seen_at) from dpdp.identity i where i.id = v_id),
    'organisations', coalesce((
      select jsonb_agg(jsonb_build_object('name', o.name, 'level', m.level::text, 'state', m.state::text, 'since', m.created_at) order by m.created_at)
      from dpdp.membership m join dpdp.organisation o on o.id = m.org_id where m.identity_id = v_id), '[]'::jsonb),
    'nominee', (select jsonb_build_object('name', n.name, 'email', n.email, 'relation', n.relation, 'recordedAt', n.recorded_at) from dpdp.person_nominee n where n.identity_id = v_id),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('ref', coalesce(r.ticket_no, left(r.id, 8)), 'kind', r.kind, 'state', r.state, 'receivedAt', r.received_at, 'dueAt', r.due_at) order by r.received_at desc)
      from dpdp.person_request r where r.identity_id = v_id), '[]'::jsonb),
    'emailsSent', (select count(*) from dpdp.email_send e where e.identity_id = v_id),
    'actionsRecorded', (select count(*) from dpdp.event e where e.actor_identity_id = v_id)
  );
end
$$;

-- ---- a request (sections 11 and 12) -------------------------------------------------------------------------------------------------------------------------
create or replace function public.dpdp_request_my_right(p_kind text, p_details text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := public.dpdp__caller_identity_id();
  v_email text;
  v_details text := nullif(btrim(left(coalesce(p_details, ''), 2000)), '');
  v_open integer;
  v_ticket jsonb;
  v_req dpdp.person_request;
begin
  if v_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('access', 'correction', 'erasure') then
    return jsonb_build_object('ok', false, 'reason', 'Choose what you are asking for.');
  end if;
  if p_kind = 'correction' and v_details is null then
    return jsonb_build_object('ok', false, 'reason', 'Please say what is wrong and what it should be.');
  end if;
  select count(*) into v_open from dpdp.person_request r where r.identity_id = v_id and r.state = 'open';
  if v_open >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'You already have several open requests. We will answer them first.');
  end if;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_id;
  v_ticket := public.dpdp_mail_insert_inbound(
    'data_request', v_email, 'Own-data request: ' || p_kind, 'own-right-' || replace(gen_random_uuid()::text, '-', ''),
    now(), 30, null, 'dpdp@veridian-aios.com', null, null, left('Asked from the signed-in application. ' || coalesce(v_details, ''), 4096),
    'asked in the application', null, false, false);
  insert into dpdp.person_request (identity_id, kind, details, ticket_no, due_at)
  values (v_id, p_kind, v_details, v_ticket ->> 'ticketNo', now() + interval '30 days')
  returning * into v_req;
  return jsonb_build_object('ok', true, 'ref', v_req.ticket_no, 'dueAt', v_req.due_at);
end
$$;

-- ---- nomination (section 14) --------------------------------------------------------------------------------------------------------------------------------
create or replace function public.dpdp_set_my_nominee(p_name text, p_email text default null, p_relation text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := public.dpdp__caller_identity_id();
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_rel text := nullif(btrim(coalesce(p_relation, '')), '');
begin
  if v_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'Please give the name of the person you nominate.');
  end if;
  if v_email is not null and (char_length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object('ok', false, 'reason', 'That does not look like an e-mail address.');
  end if;
  if v_rel is not null and char_length(v_rel) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'Please shorten the relationship.');
  end if;
  insert into dpdp.person_nominee (identity_id, name, email, relation) values (v_id, v_name, v_email, v_rel)
  on conflict (identity_id) do update set name = excluded.name, email = excluded.email, relation = excluded.relation, recorded_at = now();
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.dpdp_clear_my_nominee()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := public.dpdp__caller_identity_id();
begin
  if v_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  delete from dpdp.person_nominee where identity_id = v_id;
  return jsonb_build_object('ok', true);
end
$$;

-- ---- single-person erasure (section 12) -----------------------------------------------------------------------------------------------------------------------
-- Operator only (no public wrapper, no grant to anon / authenticated). What it does for one identity:
--   * ends every membership, removes sign-in tokens, sessions, e-mail action tokens, visit links, extra e-mail addresses, the nominee, and the text of the person's requests;
--   * blanks the stored text of every e-mail we sent them and the address on our sent-mail and inbound-mail records;
--   * unlinks the person from the organisation's record of actions (dpdp.event.actor_identity_id, which is not part of any hash) and replaces the identity's e-mail with a placeholder.
-- What it keeps, on purpose: dpdp.event rows themselves (they are the customer organisation's record, hash-chained, and name an action, not a person's details),
-- payment and invoice records (tax law), the audit log (one-year rule). It refuses a platform administrator.
create or replace function dpdp.erase_person(p_identity text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_emails text[];
  v_n jsonb := '{}'::jsonb;
  v_c integer;
begin
  select i.primary_email into v_email from dpdp.identity i where i.id = p_identity;
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'No such person');
  end if;
  if v_email like 'erased+%@erased.invalid' then
    return jsonb_build_object('ok', true, 'alreadyErased', true);
  end if;
  if exists (select 1 from dpdp.platform_admin a where lower(a.email) = lower(v_email)) then
    return jsonb_build_object('ok', false, 'reason', 'A platform administrator cannot be erased this way');
  end if;
  select coalesce(array_agg(lower(e.email)), '{}') || lower(v_email) into v_emails from dpdp.identity_email e where e.identity_id = p_identity;

  update dpdp.membership set state = 'revoked', revoked_at = coalesce(revoked_at, (clock_timestamp() at time zone 'UTC')) where identity_id = p_identity and state <> 'revoked';
  get diagnostics v_c = row_count;
  v_n := v_n || jsonb_build_object('membershipsEnded', v_c);
  delete from dpdp.login_token where identity_id = p_identity;
  delete from dpdp.session where identity_id = p_identity;
  delete from dpdp.email_action_token where identity_id = p_identity;
  delete from dpdp.email_token where identity_id = p_identity;
  delete from dpdp.visit_link where identity_id = p_identity;
  delete from dpdp.person_nominee where identity_id = p_identity;
  update dpdp.person_request set details = null where identity_id = p_identity;
  update dpdp.email_send set to_email = 'erased', body_text = null, subject = null where identity_id = p_identity;
  get diagnostics v_c = row_count;
  v_n := v_n || jsonb_build_object('emailsBlanked', v_c);
  update dpdp.mail_outbound set to_addr = 'erased', subject = null where lower(to_addr) = any (v_emails);
  update dpdp.mail_inbound set from_addr = 'erased', excerpt = null, subject = null where lower(from_addr) = any (v_emails);
  get diagnostics v_c = row_count;
  v_n := v_n || jsonb_build_object('inboundBlanked', v_c);
  update dpdp.event set actor_identity_id = null where actor_identity_id = p_identity;
  delete from dpdp.identity_email where identity_id = p_identity;
  update dpdp.identity set primary_email = 'erased+' || p_identity || '@erased.invalid' where id = p_identity;
  return jsonb_build_object('ok', true, 'detail', v_n, 'reason', left(p_reason, 300));
end
$$;

-- ---- who may call what -------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.dpdp_my_data() from public, anon;
revoke all on function public.dpdp_request_my_right(text, text) from public, anon;
revoke all on function public.dpdp_set_my_nominee(text, text, text) from public, anon;
revoke all on function public.dpdp_clear_my_nominee() from public, anon;
grant execute on function public.dpdp_my_data() to authenticated;
grant execute on function public.dpdp_request_my_right(text, text) to authenticated;
grant execute on function public.dpdp_set_my_nominee(text, text, text) to authenticated;
grant execute on function public.dpdp_clear_my_nominee() to authenticated;
revoke all on function dpdp.erase_person(text, text) from public, anon, authenticated;
