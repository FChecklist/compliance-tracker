-- PRE-APPROVED-LIVE-DDL: Owner requirement relayed by the boss session on 2026-11-14 ("fix the DPDP product on lines of Identify, Classify, Prove (ICP) ... Prove: evidence/consent/breach/rights/grievance/vendor/erasure/evidence pack"). FILE ONLY: this migration is NOT applied to any database; applying it to the live project needs the owner's separate go and a recorded rollback id (drizzle/down/0762_dpdp_icp_prove.down.sql). Apply AFTER drizzle/0761.
--
-- DPDP ICP weekly lifecycle, slice 2 of 3: PROVE.
--
--   EVIDENCE    dpdp.icp_evidence (append-only; a line can be withdrawn once, never edited or deleted). A piece of evidence is a fingerprint (SHA-256 worked out in the
--               browser, the file never leaves the organisation), a file name, a reference to where the original is kept, and a date. It can point at a register line
--               (a signed agreement with an outside helper) or at a job. The product does not hold the document, so it says "recorded by you", never "verified".
--   BREACH      public.dpdp_icp_breach_* on the existing dpdp.breach (Rule 7 fields from 0726): log, the board / people / CERT-In timestamps, the 72-hour detail, close.
--   REQUESTS    public.dpdp_icp_request_* on the existing dpdp.rights_request and dpdp.grievance: log (access, correction, erasure, nominee, grievance), the 90-day ceiling
--               of Rule 14(3) as the due date, answer. Only the TYPE, the dates and a short outcome word are kept: never the person's name or what they asked.
--   ERASURE     dpdp.icp_erasure: what was due to be erased, why, by when, done on, how.
--   PACK        public.dpdp_icp_evidence_pack(): one JSON the organisation can print or hand to a lawyer or the Board: register, evidence, notices, consent counts, breaches,
--               requests, vendors, erasures, jobs, the weekly record, and a check of the History chain. No personal data of any individual is in it.
--   CHECKLIST   dpdp.icp_prove() is replaced (it was the placeholder from 0761) with the real steps.
--
-- Nothing here says "compliant", "certified" or "guaranteed". A count of what is overdue is a prompt to act, not a finding. Free text refused if it looks like an e-mail
-- address or a phone number (it is the organisation's own record of THINGS and DATES, not of people). ADDITIVE and re-runnable. RLS on every new table, no grant to
-- anon / authenticated; only the SECURITY DEFINER functions touch them.

begin;
set local lock_timeout = '5s';

-- (dpdp.icp_not_contact, dpdp.icp_offboarding and dpdp.icp_actor_label come from drizzle/0761.)

-- ---------------------------------------------------------------------
-- 2. Evidence (append-only)
-- ---------------------------------------------------------------------
create table if not exists dpdp.icp_evidence (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null references dpdp.organisation (id),
  kind text not null check (kind in ('policy', 'notice', 'consent', 'agreement', 'training', 'assessment', 'breach_report', 'request_log', 'other')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  reference text check (reference is null or char_length(reference) <= 200),            -- where the original is kept ("Admin office cabinet 3", a drive folder name)
  filename text check (filename is null or char_length(filename) <= 200),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  evidence_on date not null,
  item_id text references dpdp.icp_item (id),
  obligation_id text references dpdp.obligation (id),
  week_start date not null check (extract(isodow from week_start) = 1),
  recorded_by text,                                                                       -- identity id
  actor_label text,
  recorded_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  withdrawn_at timestamp,
  withdrawn_reason text check (withdrawn_reason is null or char_length(withdrawn_reason) <= 200),
  constraint icp_evidence_has_proof check (sha256 is not null or reference is not null),
  constraint icp_evidence_title_not_contact check (title !~ '@' and title !~ '[0-9][0-9 -]{8,}[0-9]'),
  constraint icp_evidence_reference_not_contact check (reference is null or (reference !~ '@' and reference !~ '[0-9][0-9 -]{8,}[0-9]')),
  constraint icp_evidence_filename_not_contact check (filename is null or (filename !~ '@' and filename !~ '[0-9][0-9 -]{8,}[0-9]'))
);
create index if not exists icp_evidence_org_week_idx on dpdp.icp_evidence (org_id, week_start desc, recorded_at desc);
create index if not exists icp_evidence_item_idx on dpdp.icp_evidence (item_id) where item_id is not null;
alter table dpdp.icp_evidence enable row level security;
revoke all on table dpdp.icp_evidence from public, anon, authenticated;

create or replace function dpdp.icp_evidence_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if dpdp.icp_offboarding(old.org_id) then return old; end if;
    raise exception 'Evidence is kept as recorded; withdraw it instead' using errcode = '42501';
  end if;
  -- the only change ever allowed: withdraw a line once
  if old.withdrawn_at is null and new.withdrawn_at is not null
     and (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_reason') = (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_reason') then
    return new;
  end if;
  raise exception 'Evidence is kept as recorded; withdraw it instead' using errcode = '42501';
end
$$;
drop trigger if exists icp_evidence_guard on dpdp.icp_evidence;
create trigger icp_evidence_guard before update or delete on dpdp.icp_evidence for each row execute function dpdp.icp_evidence_guard();

-- ---------------------------------------------------------------------
-- 3. Erasure log
-- ---------------------------------------------------------------------
create table if not exists dpdp.icp_erasure (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null references dpdp.organisation (id),
  item_id text references dpdp.icp_item (id),
  scope text not null check (char_length(btrim(scope)) between 2 and 160),                 -- WHAT is to be erased ("Admission forms 2019"), never a person
  trigger_kind text not null check (trigger_kind in ('retention_ended', 'person_request', 'consent_withdrawn', 'purpose_served', 'other')),
  due_on date not null,
  state text not null default 'open' check (state in ('open', 'done', 'not_needed')),
  done_on date,
  method text check (method is null or char_length(method) <= 160),
  created_by text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  closed_by text,
  closed_at timestamp,
  constraint icp_erasure_scope_not_contact check (scope !~ '@' and scope !~ '[0-9][0-9 -]{8,}[0-9]'),
  constraint icp_erasure_method_not_contact check (method is null or (method !~ '@' and method !~ '[0-9][0-9 -]{8,}[0-9]')),
  constraint icp_erasure_closed_has_date check (state = 'open' or done_on is not null)
);
create index if not exists icp_erasure_org_state_idx on dpdp.icp_erasure (org_id, state, due_on);
alter table dpdp.icp_erasure enable row level security;
revoke all on table dpdp.icp_erasure from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Grievance: the date it arrived (the table only had the dates it is due).
-- ---------------------------------------------------------------------
alter table dpdp.grievance add column if not exists received_at timestamp;

-- ---------------------------------------------------------------------
-- 5. EVIDENCE: add, list, withdraw
-- ---------------------------------------------------------------------
create or replace function public.dpdp_icp_evidence_add(p_org_id text, p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_kind text := coalesce(p ->> 'kind', 'other');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_ref text := nullif(btrim(coalesce(p ->> 'reference', '')), '');
  v_file text := nullif(btrim(coalesce(p ->> 'filename', '')), '');
  v_sha text := nullif(lower(btrim(coalesce(p ->> 'sha256', ''))), '');
  v_size bigint;
  v_on date;
  v_item dpdp.icp_item;
  v_ob text;
  v_id text := replace(gen_random_uuid()::text, '-', '');
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  if v_kind not in ('policy', 'notice', 'consent', 'agreement', 'training', 'assessment', 'breach_report', 'request_log', 'other') then
    raise exception 'Pick what kind of record this is' using errcode = '22023';
  end if;
  if char_length(v_title) < 2 or char_length(v_title) > 120 then raise exception 'Give it a short title (2 to 120 characters)' using errcode = '22023'; end if;
  if v_ref is not null and char_length(v_ref) > 200 then raise exception 'Where it is kept can be 200 characters at most' using errcode = '22023'; end if;
  if v_file is not null and char_length(v_file) > 200 then raise exception 'A file name can be 200 characters at most' using errcode = '22023'; end if;
  if not (dpdp.icp_not_contact(v_title) and dpdp.icp_not_contact(v_ref) and dpdp.icp_not_contact(v_file)) then
    raise exception 'This looks like a person''s e-mail address or phone number. Describe the record without it' using errcode = '22023';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then raise exception 'The fingerprint must be 64 letters and digits (SHA-256)' using errcode = '22023'; end if;
  if v_sha is null and v_ref is null then raise exception 'Add the file''s fingerprint, or say where the original is kept' using errcode = '22023'; end if;
  begin
    v_size := nullif(p ->> 'sizeBytes', '')::bigint;
    v_on := coalesce(nullif(p ->> 'evidenceOn', '')::date, v_today);
  exception when others then
    raise exception 'Check the date and the size' using errcode = '22023';
  end;
  if v_size is not null and v_size < 0 then raise exception 'Check the size' using errcode = '22023'; end if;
  if v_on > v_today + 1 or v_on < date '2000-01-01' then raise exception 'The date of the record looks wrong' using errcode = '22023'; end if;
  if nullif(p ->> 'itemId', '') is not null then
    select * into v_item from dpdp.icp_item where id = p ->> 'itemId' and org_id = p_org_id and status = 'active';   -- a retired line takes no new record
    if v_item.id is null then raise exception 'That register line was not found' using errcode = 'P0002'; end if;
  end if;
  if nullif(p ->> 'obligationId', '') is not null then
    select ob.id into v_ob from dpdp.obligation ob where ob.id = p ->> 'obligationId' and ob.org_id = p_org_id;
    if v_ob is null then raise exception 'That job was not found' using errcode = 'P0002'; end if;
  end if;
  v_label := dpdp.icp_actor_label(v_m);

  insert into dpdp.icp_evidence (id, org_id, kind, title, reference, filename, sha256, size_bytes, evidence_on, item_id, obligation_id, week_start, recorded_by, actor_label)
  values (v_id, p_org_id, v_kind, v_title, v_ref, v_file, v_sha, v_size, v_on, v_item.id, v_ob, dpdp.icp_week(), v_m.identity_id, v_label);

  -- a signed agreement with an outside helper is the evidence for that line's agreement status
  if v_kind = 'agreement' and v_item.id is not null and v_item.kind = 'vendor' then
    update dpdp.icp_item
       set agreement_status = 'signed', agreement_ref = left(coalesce(v_ref, v_title), 120), agreement_on = v_on,
           updated_at = (clock_timestamp() at time zone 'UTC')
     where id = v_item.id;
  end if;
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_evidence_recorded', 'Recorded 1 piece of evidence', v_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

create or replace function public.dpdp_icp_evidence_withdraw(p_org_id text, p_evidence_id text, p_reason text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_n integer;
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then raise exception 'Say in a few words why (3 to 200 characters)' using errcode = '22023'; end if;
  if not dpdp.icp_not_contact(v_reason) then raise exception 'Leave out e-mail addresses and phone numbers' using errcode = '22023'; end if;
  update dpdp.icp_evidence set withdrawn_at = (clock_timestamp() at time zone 'UTC'), withdrawn_reason = v_reason
   where id = p_evidence_id and org_id = p_org_id and withdrawn_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That record was not found or is already withdrawn' using errcode = 'P0002'; end if;
  v_label := dpdp.icp_actor_label(v_m);
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_evidence_withdrawn', 'Withdrew 1 piece of evidence', p_evidence_id);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 6. BREACH: log, update, (list is in the overview)
-- ---------------------------------------------------------------------
create or replace function public.dpdp_icp_breach_log(p_org_id text, p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_aware timestamp;
  v_desc text := btrim(coalesce(p ->> 'description', ''));
  v_nature text := nullif(btrim(coalesce(p ->> 'nature', '')), '');
  v_extent text := nullif(btrim(coalesce(p ->> 'extent', '')), '');
  v_where text := nullif(btrim(coalesce(p ->> 'location', '')), '');
  v_impact text := nullif(btrim(coalesce(p ->> 'likelyImpact', '')), '');
  v_people integer;
  v_id text := replace(gen_random_uuid()::text, '-', '');
begin
  perform set_config('dpdp.allow_locked', 'on', true);   -- a legal duty (the 72-hour clock) stays open on a locked account, as 0734 decided
  v_m := public.dpdp__icp_member(p_org_id, true);
  if char_length(v_desc) < 5 or char_length(v_desc) > 2000 then raise exception 'Describe what happened in a few sentences (5 to 2000 characters)' using errcode = '22023'; end if;
  if coalesce(char_length(v_nature), 0) > 500 or coalesce(char_length(v_extent), 0) > 500 or coalesce(char_length(v_where), 0) > 500 or coalesce(char_length(v_impact), 0) > 500 then
    raise exception 'Each of nature, extent, place and likely impact can be 500 characters at most' using errcode = '22023';
  end if;
  if not (dpdp.icp_not_contact(v_desc) and dpdp.icp_not_contact(v_nature) and dpdp.icp_not_contact(v_extent) and dpdp.icp_not_contact(v_where) and dpdp.icp_not_contact(v_impact)) then
    raise exception 'Describe it without any person''s e-mail address or phone number: the record lists what happened, not who' using errcode = '22023';
  end if;
  begin
    -- read as an instant (an offset such as +05:30 is honoured) and stored as UTC; a date alone counts from 00:00 UTC
    v_aware := coalesce((nullif(p ->> 'becameAwareAt', '')::timestamptz) at time zone 'UTC', v_now);
    v_people := nullif(p ->> 'peopleAffected', '')::integer;
  exception when others then
    raise exception 'Check the date and the number of people' using errcode = '22023';
  end;
  if v_aware > v_now + interval '5 minutes' or v_aware < v_now - interval '365 days' then raise exception 'The date you became aware looks wrong' using errcode = '22023'; end if;
  if v_people is not null and (v_people < 0 or v_people > 1000000000) then raise exception 'Check the number of people' using errcode = '22023'; end if;
  v_label := dpdp.icp_actor_label(v_m);

  insert into dpdp.breach (id, org_id, became_aware_at, deadline_at, scope_person_count, state, description, nature, extent, location, likely_impact)
  values (v_id, p_org_id, v_aware, v_aware + interval '72 hours', v_people, 'open', v_desc, v_nature, v_extent, v_where, v_impact);
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'breach_recorded', 'A personal data breach was recorded', v_id);
  return jsonb_build_object('ok', true, 'id', v_id,
    'boardDetailDueAt', to_char(v_aware + interval '72 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'certInDueAt', to_char(v_aware + interval '6 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end
$$;

-- Marks one step of a breach. A timestamp is set the first time only (it is a record of when it happened, not a field to edit). 'closed' ends it.
create or replace function public.dpdp_icp_breach_update(p_org_id text, p_breach_id text, p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  b dpdp.breach;
  v_ref text := nullif(btrim(coalesce(p ->> 'certInReference', '')), '');
  v_mit text := nullif(btrim(coalesce(p ->> 'mitigation', '')), '');
  v_cause text := nullif(btrim(coalesce(p ->> 'cause', '')), '');
  v_steps text := nullif(btrim(coalesce(p ->> 'remedialSteps', '')), '');
  v_people integer;
  v_rows integer;
begin
  perform set_config('dpdp.allow_locked', 'on', true);   -- a legal duty stays open on a locked account (0734)
  v_m := public.dpdp__icp_member(p_org_id, true);
  select * into b from dpdp.breach where id = p_breach_id and org_id = p_org_id for update;
  if b.id is null then raise exception 'That record was not found' using errcode = 'P0002'; end if;
  if b.state = 'closed' then raise exception 'This breach record is closed' using errcode = '55000'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then raise exception 'Say what to update' using errcode = '22023'; end if;
  begin
    perform (p ->> 'boardNotified')::boolean, (p ->> 'boardDetailed')::boolean, (p ->> 'individualsNotified')::boolean, (p ->> 'certInReported')::boolean, (p ->> 'closed')::boolean;
  exception when others then
    raise exception 'Tick a box or leave it' using errcode = '22023';
  end;
  -- a breach is closed only after the detailed report to the Board has been made (or was already made): closing must not make a late report disappear
  if coalesce((p ->> 'closed')::boolean, false) and b.board_detailed_at is null and not coalesce((p ->> 'boardDetailed')::boolean, false) then
    raise exception 'Record the detailed report to the Board before closing this breach' using errcode = '22023';
  end if;
  if coalesce(char_length(v_ref), 0) > 80 or coalesce(char_length(v_mit), 0) > 1000 or coalesce(char_length(v_cause), 0) > 1000 or coalesce(char_length(v_steps), 0) > 1000 then
    raise exception 'A note is too long (up to 1000 characters; the reference up to 80)' using errcode = '22023';
  end if;
  if not (dpdp.icp_not_contact(v_ref) and dpdp.icp_not_contact(v_mit) and dpdp.icp_not_contact(v_cause) and dpdp.icp_not_contact(v_steps)) then
    raise exception 'Leave out any person''s e-mail address or phone number' using errcode = '22023';
  end if;
  begin
    v_people := nullif(p ->> 'peopleAffected', '')::integer;
  exception when others then
    raise exception 'Check the number of people' using errcode = '22023';
  end;
  if v_people is not null and (v_people < 0 or v_people > 1000000000) then raise exception 'Check the number of people' using errcode = '22023'; end if;

  update dpdp.breach set
    board_notified_at = case when coalesce((p ->> 'boardNotified')::boolean, false) then coalesce(board_notified_at, v_now) else board_notified_at end,
    board_detailed_at = case when coalesce((p ->> 'boardDetailed')::boolean, false) then coalesce(board_detailed_at, v_now) else board_detailed_at end,
    individuals_notified_at = case when coalesce((p ->> 'individualsNotified')::boolean, false) then coalesce(individuals_notified_at, v_now) else individuals_notified_at end,
    cert_in_reported_at = case when coalesce((p ->> 'certInReported')::boolean, false) then coalesce(cert_in_reported_at, v_now) else cert_in_reported_at end,
    cert_in_reference = coalesce(v_ref, cert_in_reference),
    board_mitigation = coalesce(v_mit, board_mitigation),
    board_cause_findings = coalesce(v_cause, board_cause_findings),
    board_remedial_steps = coalesce(v_steps, board_remedial_steps),
    scope_person_count = coalesce(v_people, scope_person_count),
    state = case when coalesce((p ->> 'closed')::boolean, false) then 'closed' else state end
  where id = b.id and state <> 'closed';   -- an older flow's 'notified' is still a live breach
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'This breach record is closed' using errcode = '55000'; end if;
  v_label := dpdp.icp_actor_label(v_m);
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'breach_updated',
    case when coalesce((p ->> 'closed')::boolean, false) then 'Closed a personal data breach record' else 'Updated a personal data breach record' end, b.id);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 7. REQUESTS: rights requests (access / correction / erasure / nominee) and grievances. Rule 14(3): a reply within 90 days at most.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_icp_request_log(p_org_id text, p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_type text := coalesce(p ->> 'type', '');
  v_via text := coalesce(nullif(p ->> 'arrivedVia', ''), 'other');
  v_on date;
  v_sum text := nullif(btrim(coalesce(p ->> 'summary', '')), '');
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_ref text;
  v_recv timestamp;
  v_due timestamp;
begin
  perform set_config('dpdp.allow_locked', 'on', true);   -- answering a person stays open on a locked account (0734)
  v_m := public.dpdp__icp_member(p_org_id, true);
  if v_type not in ('access', 'correction', 'erasure', 'nominee', 'grievance') then raise exception 'Pick the kind of request' using errcode = '22023'; end if;
  if v_via not in ('in_person', 'email', 'post', 'phone', 'portal', 'other') then raise exception 'Pick how it arrived' using errcode = '22023'; end if;
  begin
    v_on := coalesce(nullif(p ->> 'receivedOn', '')::date, v_today);
  exception when others then
    raise exception 'Check the date it arrived' using errcode = '22023';
  end;
  if v_on > v_today + 1 or v_on < v_today - 365 then raise exception 'The date it arrived looks wrong' using errcode = '22023'; end if;
  if v_type = 'grievance' then
    if v_sum is null or char_length(v_sum) < 3 or char_length(v_sum) > 300 then raise exception 'Say in a few words what it is about (3 to 300 characters)' using errcode = '22023'; end if;
    if not dpdp.icp_not_contact(v_sum) then raise exception 'Leave out the person''s e-mail address and phone number: the log keeps the subject, not who' using errcode = '22023'; end if;
  end if;
  v_recv := v_on::timestamp;
  v_due := v_recv + interval '90 days';
  v_ref := case when v_type = 'grievance' then 'GR-' else 'RR-' end || upper(substr(v_id, 1, 8));
  v_label := dpdp.icp_actor_label(v_m);
  if v_type = 'grievance' then
    insert into dpdp.grievance (id, org_id, ref, summary, tier, officer_due_at, state, received_at)
    values (v_id, p_org_id, v_ref, v_sum, 1, v_due, 'open', v_recv);
  else
    insert into dpdp.rights_request (id, org_id, ref, kind, arrived_via, received_at, due_at, state)
    values (v_id, p_org_id, v_ref, v_type, v_via, v_recv, v_due, 'open');
  end if;
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_request_logged',
    case when v_type = 'grievance' then 'Logged a grievance' else 'Logged a request from a person' end, v_ref);
  return jsonb_build_object('ok', true, 'ref', v_ref, 'dueOn', to_char(v_due, 'YYYY-MM-DD'));
end
$$;

create or replace function public.dpdp_icp_request_close(p_org_id text, p_ref text, p_outcome text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_out text := coalesce(p_outcome, '');
  v_n integer;
begin
  perform set_config('dpdp.allow_locked', 'on', true);   -- answering a person stays open on a locked account (0734)
  v_m := public.dpdp__icp_member(p_org_id, true);
  if v_out not in ('provided', 'corrected', 'erased', 'refused_with_reason', 'withdrawn', 'answered') then raise exception 'Pick how it was answered' using errcode = '22023'; end if;
  v_label := dpdp.icp_actor_label(v_m);
  -- the reference is looked up where it lives (a grievance made before this screen has a G-0001 style reference, so the prefix is not a safe guide);
  -- a decision the officer already wrote is never overwritten
  update dpdp.grievance set state = 'answered', officer_decision = coalesce(officer_decision, v_out) where ref = p_ref and org_id = p_org_id and state = 'open';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    update dpdp.rights_request set state = 'answered', answered_at = v_now, answer_text = coalesce(answer_text, v_out) where ref = p_ref and org_id = p_org_id and answered_at is null;
    get diagnostics v_n = row_count;
  end if;
  if v_n = 0 then raise exception 'That request was not found or is already answered' using errcode = 'P0002'; end if;
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_request_answered', 'Answered a request', p_ref);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 8. ERASURE log
-- ---------------------------------------------------------------------
create or replace function public.dpdp_icp_erasure_log(p_org_id text, p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_scope text := btrim(coalesce(p ->> 'scope', ''));
  v_trig text := coalesce(nullif(p ->> 'trigger', ''), 'other');
  v_due date;
  v_item text;
  v_id text := replace(gen_random_uuid()::text, '-', '');
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  if char_length(v_scope) < 2 or char_length(v_scope) > 160 then raise exception 'Say what is to be erased (2 to 160 characters)' using errcode = '22023'; end if;
  if not dpdp.icp_not_contact(v_scope) then raise exception 'Name the data set, not a person: leave out e-mail addresses and phone numbers' using errcode = '22023'; end if;
  if v_trig not in ('retention_ended', 'person_request', 'consent_withdrawn', 'purpose_served', 'other') then raise exception 'Pick why this erasure is needed' using errcode = '22023'; end if;
  begin
    v_due := coalesce(nullif(p ->> 'dueOn', '')::date, v_today + 30);
  exception when others then
    raise exception 'Check the due date' using errcode = '22023';
  end;
  if v_due < v_today - 365 or v_due > v_today + 3650 then raise exception 'The due date looks wrong' using errcode = '22023'; end if;
  if nullif(p ->> 'itemId', '') is not null then
    select i.id into v_item from dpdp.icp_item i where i.id = p ->> 'itemId' and i.org_id = p_org_id;
    if v_item is null then raise exception 'That register line was not found' using errcode = 'P0002'; end if;
  end if;
  v_label := dpdp.icp_actor_label(v_m);
  insert into dpdp.icp_erasure (id, org_id, item_id, scope, trigger_kind, due_on, created_by) values (v_id, p_org_id, v_item, v_scope, v_trig, v_due, v_m.identity_id);
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_erasure_logged', 'Logged 1 erasure to do', v_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

create or replace function public.dpdp_icp_erasure_close(p_org_id text, p_erasure_id text, p jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_state text := coalesce(nullif(p ->> 'state', ''), 'done');
  v_on date;
  v_method text := nullif(btrim(coalesce(p ->> 'method', '')), '');
  v_n integer;
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  if p is null or jsonb_typeof(p) <> 'object' or nullif(p ->> 'state', '') is null then raise exception 'Say whether it was done or is not needed' using errcode = '22023'; end if;
  if v_state not in ('done', 'not_needed') then raise exception 'Say whether it was done or is not needed' using errcode = '22023'; end if;
  begin
    v_on := coalesce(nullif(p ->> 'doneOn', '')::date, v_today);
  exception when others then
    raise exception 'Check the date' using errcode = '22023';
  end;
  if v_on > v_today + 1 or v_on < v_today - 3650 then raise exception 'The date looks wrong' using errcode = '22023'; end if;
  if coalesce(char_length(v_method), 0) > 160 then raise exception 'Say how in 160 characters at most' using errcode = '22023'; end if;
  if v_state = 'not_needed' and v_method is null then raise exception 'Say why it is not needed' using errcode = '22023'; end if;
  if not dpdp.icp_not_contact(v_method) then raise exception 'Leave out e-mail addresses and phone numbers' using errcode = '22023'; end if;
  v_label := dpdp.icp_actor_label(v_m);
  update dpdp.icp_erasure set state = v_state, done_on = v_on, method = v_method, closed_by = v_m.identity_id, closed_at = (clock_timestamp() at time zone 'UTC')
   where id = p_erasure_id and org_id = p_org_id and state = 'open';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That erasure was not found or is already closed' using errcode = 'P0002'; end if;
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_erasure_closed', case when v_state = 'done' then 'Marked 1 erasure done' else 'Marked 1 erasure not needed' end, p_erasure_id);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 9. PROVE counts, the overview for the screen, and the real checklist steps
-- ---------------------------------------------------------------------
create or replace function dpdp.icp_prove_counts(p_org_id text, p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  return jsonb_build_object(
    'jobsLate', (select count(*) from dpdp.obligation ob where ob.org_id = p_org_id and ob.state not in ('closed', 'submitted', 'not_applicable') and ob.due_on < v_today),
    'events', (select count(*) from dpdp.event e where e.org_id = p_org_id and e.occurred_at >= p_week::timestamp),
    'evidenceThisWeek', (select count(*) from dpdp.icp_evidence x where x.org_id = p_org_id and x.week_start = p_week and x.withdrawn_at is null),
    'nothingToAttach', exists (select 1 from dpdp.icp_run r where r.org_id = p_org_id and r.week_start = p_week and r.stage = 'prove' and r.by_kind = 'person' and r.outcome = 'skipped'),   -- "nothing to attach this week"
    'signed', exists (select 1 from dpdp.icp_run r where r.org_id = p_org_id and r.week_start = p_week and r.stage = 'prove' and r.by_kind = 'person' and r.outcome = 'ok'),
    -- a signed agreement should have a record behind it
    'agreementsWithoutEvidence', (select count(*) from dpdp.icp_item i
        where i.org_id = p_org_id and i.status = 'active' and i.kind = 'vendor' and i.agreement_status = 'signed'
          and not exists (select 1 from dpdp.icp_evidence x where x.item_id = i.id and x.kind = 'agreement' and x.withdrawn_at is null)),
    -- a request or grievance is past due only AFTER its due date has gone (the 90th day itself is still in time)
    -- the 72-hour detailed report to the Board is the clock the Rules set; the first intimation is "without delay" and has no fixed hour
    'breachesPastClock', (select count(*) from dpdp.breach b where b.org_id = p_org_id and b.state <> 'closed' and b.deadline_at < v_now and b.board_detailed_at is null),
    'breachesOpen', (select count(*) from dpdp.breach b where b.org_id = p_org_id and b.state <> 'closed'),
    'requestsPastDue', (select count(*) from dpdp.rights_request r where r.org_id = p_org_id and r.answered_at is null and r.due_at::date < v_today)
                     + (select count(*) from dpdp.grievance g where g.org_id = p_org_id and g.state = 'open' and g.officer_due_at::date < v_today),
    'requestsOpen', (select count(*) from dpdp.rights_request r where r.org_id = p_org_id and r.answered_at is null)
                  + (select count(*) from dpdp.grievance g where g.org_id = p_org_id and g.state = 'open'),
    'erasuresPastDue', (select count(*) from dpdp.icp_erasure e where e.org_id = p_org_id and e.state = 'open' and e.due_on < v_today),
    'erasuresOpen', (select count(*) from dpdp.icp_erasure e where e.org_id = p_org_id and e.state = 'open')
  );
end
$$;
revoke all on function dpdp.icp_prove_counts(text, date) from public, anon, authenticated;

create or replace function dpdp.icp_prove(p_org_id text, p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := dpdp.icp_prove_counts(p_org_id, p_week);
begin
  return dpdp.icp_section(array[
    dpdp.icp_step('jobs_not_late', 'No job is late', (c ->> 'jobsLate')::int = 0, (c ->> 'jobsLate')::int, 'jobs'),
    dpdp.icp_step('evidence_this_week', 'Attach this week''s records (or say there is nothing to attach)', (c ->> 'evidenceThisWeek')::int > 0 or (c ->> 'nothingToAttach')::boolean, (c ->> 'evidenceThisWeek')::int, 'evidence'),
    dpdp.icp_step('agreements_on_record', 'Each signed agreement with an outside helper has its record attached', (c ->> 'agreementsWithoutEvidence')::int = 0, (c ->> 'agreementsWithoutEvidence')::int, 'evidence'),
    dpdp.icp_step('breach_clocks', 'No open breach is past its 72-hour report to the Board', (c ->> 'breachesPastClock')::int = 0, (c ->> 'breachesPastClock')::int, 'breach'),
    dpdp.icp_step('requests_on_time', 'No request or grievance is past its due date', (c ->> 'requestsPastDue')::int = 0, (c ->> 'requestsPastDue')::int, 'requests'),
    dpdp.icp_step('erasures_on_time', 'No erasure is past its due date', (c ->> 'erasuresPastDue')::int = 0, (c ->> 'erasuresPastDue')::int, 'erasure'),
    dpdp.icp_step('week_signed_off', 'A person signs off the week', (c ->> 'signed')::boolean, null, 'signoff')
  ]);
end
$$;
revoke all on function dpdp.icp_prove(text, date) from public, anon, authenticated;

-- Everything the PROVE screen shows, in one read. No free text of any person: only types, dates and the organisation's own short notes.
create or replace function public.dpdp_icp_prove_overview(p_org_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_week date := dpdp.icp_week();
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  perform public.dpdp__icp_member(p_org_id, true);
  return jsonb_build_object(
    'weekStart', to_char(v_week, 'YYYY-MM-DD'),
    'counts', dpdp.icp_prove_counts(p_org_id, v_week),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'title', x.title, 'reference', x.reference, 'filename', x.filename, 'sha256', x.sha256, 'sizeBytes', x.size_bytes,
        'evidenceOn', to_char(x.evidence_on, 'YYYY-MM-DD'), 'itemId', x.item_id, 'itemName', i.name, 'obligationId', x.obligation_id,
        'recordedAt', to_char(x.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'withdrawn', x.withdrawn_at is not null, 'withdrawnReason', x.withdrawn_reason
      ) order by x.recorded_at desc), '[]'::jsonb)
      from (select * from dpdp.icp_evidence e where e.org_id = p_org_id order by e.recorded_at desc limit 200) x left join dpdp.icp_item i on i.id = x.item_id),
    'breaches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'state', b.state, 'becameAwareAt', to_char(b.became_aware_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'boardDetailDueAt', to_char(b.deadline_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'certInDueAt', to_char(b.cert_in_due_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'peopleAffected', b.scope_person_count, 'description', b.description,
        'boardNotifiedAt', to_char(b.board_notified_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'boardDetailedAt', to_char(b.board_detailed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'individualsNotifiedAt', to_char(b.individuals_notified_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'certInReportedAt', to_char(b.cert_in_reported_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'certInReference', b.cert_in_reference, 'pastClock', b.state <> 'closed' and b.deadline_at < v_now and b.board_detailed_at is null
      ) order by b.became_aware_at desc), '[]'::jsonb)
      from (select * from dpdp.breach x where x.org_id = p_org_id order by x.became_aware_at desc limit 100) b),
    -- how many rows exist against how many are listed above, so a pack that is cut short says so
    'totals', jsonb_build_object(
        'evidence', (select count(*) from dpdp.icp_evidence e where e.org_id = p_org_id),
        'breaches', (select count(*) from dpdp.breach b where b.org_id = p_org_id),
        'erasures', (select count(*) from dpdp.icp_erasure z where z.org_id = p_org_id),
        'listedMax', jsonb_build_object('evidence', 200, 'breaches', 100, 'erasures', 200)),
    'requests', (select coalesce(jsonb_agg(q.j order by q.recv desc), '[]'::jsonb) from (
        -- 'type', 'arrivedVia' and 'outcome' are each one of a few fixed words, never the free text an older flow may have stored there (that text can name a person)
        select r.received_at as recv, jsonb_build_object('ref', r.ref, 'type', case when r.kind in ('access', 'correction', 'erasure', 'nominee', 'grievance') then r.kind else 'other' end,
               'arrivedVia', case when r.arrived_via in ('in_person', 'email', 'post', 'phone', 'portal') then r.arrived_via else 'other' end, 'receivedOn', to_char(r.received_at, 'YYYY-MM-DD'),
               'dueOn', to_char(r.due_at, 'YYYY-MM-DD'), 'state', case when r.answered_at is null then 'open' else 'answered' end,
               'outcome', case when r.answered_at is null then null when r.answer_text in ('provided', 'corrected', 'erased', 'refused_with_reason', 'withdrawn', 'answered') then r.answer_text else 'answered' end,
               'pastDue', r.answered_at is null and r.due_at::date < v_now::date) as j
          from dpdp.rights_request r where r.org_id = p_org_id
        union all
        -- a grievance made before this screen has no received date: it is shown as null, never as a date worked backwards from the due date
        select coalesce(g.received_at, g.officer_due_at - interval '30 days'), jsonb_build_object('ref', g.ref, 'type', 'grievance', 'summary', g.summary,
               'receivedOn', to_char(g.received_at, 'YYYY-MM-DD'), 'dueOn', to_char(g.officer_due_at, 'YYYY-MM-DD'),
               'state', case when g.state = 'open' then 'open' else 'answered' end,
               'outcome', case when g.state = 'open' then null when g.officer_decision in ('provided', 'corrected', 'erased', 'refused_with_reason', 'withdrawn', 'answered') then g.officer_decision else 'answered' end,
               'pastDue', g.state = 'open' and g.officer_due_at::date < v_now::date)
          from dpdp.grievance g where g.org_id = p_org_id) q),
    'erasures', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'scope', e.scope, 'trigger', e.trigger_kind, 'dueOn', to_char(e.due_on, 'YYYY-MM-DD'), 'state', e.state, 'doneOn', to_char(e.done_on, 'YYYY-MM-DD'),
        'method', e.method, 'pastDue', e.state = 'open' and e.due_on < (v_now)::date, 'itemId', e.item_id
      ) order by e.due_on), '[]'::jsonb) from (select * from dpdp.icp_erasure z where z.org_id = p_org_id order by z.due_on limit 200) e),
    'vendors', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'agreementStatus', coalesce(i.agreement_status, 'none'), 'agreementRef', i.agreement_ref, 'agreementOn', to_char(i.agreement_on, 'YYYY-MM-DD'),
        'hasEvidence', exists (select 1 from dpdp.icp_evidence x where x.item_id = i.id and x.kind = 'agreement' and x.withdrawn_at is null)
      ) order by i.name), '[]'::jsonb) from dpdp.icp_item i where i.org_id = p_org_id and i.status = 'active' and i.kind = 'vendor')
  );
end
$$;

-- ---------------------------------------------------------------------
-- 10. The evidence pack
-- ---------------------------------------------------------------------
-- Walks the History chain for one organisation and says whether every link and every hash is as written (the same formula as dpdp__append_event).
create or replace function dpdp.icp_chain_check(p_org_id text, p_limit integer default 20000)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  v_prev text := null;
  v_n integer := 0;
  v_bad_link integer := 0;
  v_bad_hash integer := 0;
  v_first_bad integer := null;
  v_canonical text;
  v_total integer;
  v_head text;
  v_first timestamp;
  v_last timestamp;
begin
  select count(*), min(occurred_at), max(occurred_at) into v_total, v_first, v_last from dpdp.event where org_id = p_org_id;
  for r in select * from dpdp.event e where e.org_id = p_org_id order by e.occurred_at, e.id limit p_limit loop
    v_n := v_n + 1;
    if v_n > 1 and r.prev_hash is distinct from v_prev then
      v_bad_link := v_bad_link + 1;
      v_first_bad := coalesce(v_first_bad, v_n);
    end if;
    v_canonical := '{"actorLabel":' || to_json(r.actor_label)::text
      || ',"detail":'     || coalesce(to_json(r.detail)::text, 'null')
      || ',"kind":'       || to_json(r.kind)::text
      || ',"occurredAt":' || to_json(to_char(r.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
      || ',"orgId":'      || to_json(r.org_id)::text
      || ',"prevHash":'   || coalesce(to_json(r.prev_hash)::text, 'null')
      || ',"summary":'    || to_json(r.summary)::text
      || '}';
    if r.hash is distinct from encode(sha256(convert_to(coalesce(r.prev_hash, '') || v_canonical, 'UTF8')), 'hex') then
      v_bad_hash := v_bad_hash + 1;
      v_first_bad := coalesce(v_first_bad, v_n);
    end if;
    v_prev := r.hash;
    v_head := r.hash;
  end loop;
  return jsonb_build_object('events', v_total, 'checked', v_n, 'linksBroken', v_bad_link, 'hashesWrong', v_bad_hash, 'firstProblemAt', v_first_bad,
    'intact', v_bad_link = 0 and v_bad_hash = 0, 'headHash', v_head, 'truncated', v_total > v_n,   -- true: only the first p_limit events were walked, so headHash is not the newest one
    'firstAt', to_char(v_first, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'lastAt', to_char(v_last, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end
$$;
revoke all on function dpdp.icp_chain_check(text, integer) from public, anon, authenticated;

create or replace function public.dpdp_icp_evidence_pack(p_org_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_week date := dpdp.icp_week();
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_child boolean := dpdp.icp_child_consent_answered(p_org_id);
  v_org text;
  v_over jsonb;
begin
  perform public.dpdp__icp_member(p_org_id, true);
  select o.name into v_org from dpdp.organisation o where o.id = p_org_id;
  v_over := public.dpdp_icp_prove_overview(p_org_id);
  return jsonb_build_object(
    'what', 'Evidence pack: the organisation''s own records, as kept in VERIDIAN DPDP. It lists what the organisation recorded and when. It is not a certificate and not a legal opinion.',
    'organisation', v_org,
    'generatedAt', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'weekStart', to_char(v_week, 'YYYY-MM-DD'),
    'status', dpdp.icp_status_for(p_org_id, v_week),
    'register', (select coalesce(jsonb_agg(dpdp.icp_item_json(i, v_week, v_child) order by i.kind, i.name), '[]'::jsonb) from dpdp.icp_item i where i.org_id = p_org_id and i.status = 'active'),
    'retiredLines', (select count(*) from dpdp.icp_item i where i.org_id = p_org_id and i.status = 'retired'),
    'evidence', v_over -> 'evidence',
    'totals', v_over -> 'totals',
    'truncated', (select coalesce(jsonb_array_length(v_over -> 'evidence') < (v_over -> 'totals' ->> 'evidence')::int, false)
                       or coalesce(jsonb_array_length(v_over -> 'breaches') < (v_over -> 'totals' ->> 'breaches')::int, false)
                       or coalesce(jsonb_array_length(v_over -> 'erasures') < (v_over -> 'totals' ->> 'erasures')::int, false)),
    'notices', (select coalesce(jsonb_agg(jsonb_build_object('docKind', case when n.doc_kind ~ '^[A-Za-z][A-Za-z_ -]{0,39}$' then n.doc_kind else 'other' end, 'version', n.version, 'releasedOn', to_char(n.released_on, 'YYYY-MM-DD'),
                  'effectiveFrom', to_char(n.effective_from, 'YYYY-MM-DD'), 'effectiveTo', to_char(n.effective_to, 'YYYY-MM-DD'), 'languages', (select coalesce(jsonb_agg(l), '[]'::jsonb) from unnest(n.languages) l where l ~ '^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$'),
                  'state', case when n.state ~ '^[A-Za-z][A-Za-z_ -]{0,39}$' then n.state else 'other' end)
                  order by n.released_on desc nulls last), '[]'::jsonb) from dpdp.notice_version n where n.org_id = p_org_id),
    'consent', (
      with last as (
        select distinct on (r.token_id, r.purpose_key) r.token_id, r.granted, r.withdrawn_at
          from dpdp.consent_record r join dpdp.consent_token t on t.id = r.token_id join dpdp.consent_campaign c on c.id = t.campaign_id
         where c.org_id = p_org_id order by r.token_id, r.purpose_key, r.recorded_at desc, r.id desc)
      select jsonb_build_object(
        'campaigns', (select count(*) from dpdp.consent_campaign c where c.org_id = p_org_id),
        'linksIssued', (select count(*) from dpdp.consent_token t join dpdp.consent_campaign c on c.id = t.campaign_id where c.org_id = p_org_id),
        'linksAnswered', (select count(*) from dpdp.consent_token t join dpdp.consent_campaign c on c.id = t.campaign_id where c.org_id = p_org_id and t.acted_at is not null),
        'answersGiven', (select count(*) from last where granted and withdrawn_at is null),
        'answersRefusedOrWithdrawn', (select count(*) from last where not granted))),
    'breaches', (select coalesce(jsonb_agg(b - 'description'), '[]'::jsonb) from jsonb_array_elements(v_over -> 'breaches') b),
    'requests', (select coalesce(jsonb_agg(q - 'summary'), '[]'::jsonb) from jsonb_array_elements(v_over -> 'requests') q),
    'vendors', v_over -> 'vendors',
    'erasures', v_over -> 'erasures',
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('job', t.name, 'state', ob.state, 'dueOn', to_char(ob.due_on, 'YYYY-MM-DD'), 'closedAt', to_char(ob.closed_at, 'YYYY-MM-DD')) order by ob.due_on, ob.id), '[]'::jsonb)
               from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id where ob.org_id = p_org_id),
    'weeklyRecord', (select coalesce(jsonb_agg(jsonb_build_object('stage', r.stage, 'weekStart', to_char(r.week_start, 'YYYY-MM-DD'), 'ranAt', to_char(r.ran_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'byKind', r.by_kind, 'outcome', r.outcome, 'percent', (r.snapshot ->> 'percent')::int) order by r.ran_at desc), '[]'::jsonb)
                     from (select * from dpdp.icp_run x where x.org_id = p_org_id order by x.ran_at desc limit 200) r),
    'history', dpdp.icp_chain_check(p_org_id),
    'limits', jsonb_build_array(
      'Documents are not kept by VERIDIAN: the fingerprint, name and reference are the organisation''s own entries, recorded by the organisation.',
      'A file that gives the same fingerprint today is the same file that gave it when the organisation recorded it. VERIDIAN did not see the file and cannot check how the fingerprint was made, and a fingerprint does not show the file is correct.',
      'The date of a record is the date the organisation entered for it; the "recorded in VERIDIAN" time is set by VERIDIAN and cannot be changed.',
      'The pack is built not to contain any person''s e-mail address or phone number, and the weekly record, the breach log and the request log hold no free text about a person. The organisation''s own titles and notes are shown as it wrote them, and the words kept by VERIDIAN''s older screens (references, states) are shown as stored.')
  );
end
$$;

-- ---------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------
revoke all on function public.dpdp_icp_evidence_add(text, jsonb) from public, anon;
revoke all on function public.dpdp_icp_evidence_withdraw(text, text, text) from public, anon;
revoke all on function public.dpdp_icp_breach_log(text, jsonb) from public, anon;
revoke all on function public.dpdp_icp_breach_update(text, text, jsonb) from public, anon;
revoke all on function public.dpdp_icp_request_log(text, jsonb) from public, anon;
revoke all on function public.dpdp_icp_request_close(text, text, text) from public, anon;
revoke all on function public.dpdp_icp_erasure_log(text, jsonb) from public, anon;
revoke all on function public.dpdp_icp_erasure_close(text, text, jsonb) from public, anon;
revoke all on function public.dpdp_icp_prove_overview(text) from public, anon;
revoke all on function public.dpdp_icp_evidence_pack(text) from public, anon;
grant execute on function public.dpdp_icp_evidence_add(text, jsonb) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_evidence_withdraw(text, text, text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_breach_log(text, jsonb) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_breach_update(text, text, jsonb) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_request_log(text, jsonb) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_request_close(text, text, text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_erasure_log(text, jsonb) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_erasure_close(text, text, jsonb) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_prove_overview(text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_evidence_pack(text) to authenticated, app_runtime, service_role;

commit;
