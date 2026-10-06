-- PRE-APPROVED-LIVE-DDL: Owner-approved DPDP audit-trail specification, 2026-10-06 (chat, passed on verbatim in the work order for this change). NOT applied live by
-- the session that wrote it -- the lead applies it after review (see the PR for the exact steps and the secrets to set first).
--
-- DPDP AUDIT TRAIL (WO: audit trail, items 1-6). One append-only, hash-chained, field-sealed audit table, a separate log of every internal read of it, a daily
-- chain-head record, and the retention lifecycle (notice at day 335, 30-day masked download window, deletion at day 365 with a permanent certificate).
--
-- EXTENDS, DOES NOT REPLACE, what already exists:
--   * dpdp.event (0604/0605 dpdp__append_event) stays the business record; an AFTER INSERT trigger now mirrors every row of it into the audit chain (metadata
--     only: kind, org, actor id, the event's id -- never its summary or detail text, which can hold names), so every existing key mutation is audited without
--     touching the ~40 functions that write dpdp.event.
--   * dpdp.ai_link_call (0610) stays the per-call log; the Edge Function now also writes one audit row per call and carries the call's id in `ai_call_id`, so the
--     two join. dpdp.ai_action and dpdp.ai_draft get triggers: an AI proposal is 'ai_prepare', the person's confirmation is 'human_confirm', both with the draft id
--     as request_id, so one chain of rows ties AI read -> proposal -> human confirm -> the write.
--   * dpdp.access_log / dpdp.daily_seal (WO-DPDP-001 sketches, never wired) are left alone; the audit-specific access log and head record below are new because
--     the owner's rules differ (every internal read is logged WITH A REASON; the head is e-mailed to the owner).
--
-- HOW THE CHAIN IS WRITTEN. The ONLY thing a writer supplies is `content_canonical` (sealed JSON built by supabase/functions/_shared/audit/event.ts). A BEFORE INSERT
-- trigger does everything else: takes a per-organisation advisory lock, reads the previous row's hash (or the purge anchor, or GENESIS), stamps the id and the server
-- clock (the authority), hashes the content IN POSTGRES, and computes row_hash = sha256(prev | content_hash | id | org | server_time_us). So a direct INSERT cannot forge a
-- link either. UPDATE and DELETE are refused by a guard trigger for every role; the single exception is the purge path (below), which can only remove rows that are
-- 365 days old, for an organisation with no legal hold. TRUNCATE is refused. A superuser can of course still bypass triggers: the daily head hash, e-mailed to the
-- owner and stored outside this table's own history, is what makes that detectable.
--
-- SEALING. Personal values (IP, user-agent, device id, e-mail, personal before/after values) are sealed in the Edge Function with AES-256-GCM using a key that is an
-- Edge Function secret (DPDP_AUDIT_SEAL_KEY), NOT the database login and NOT a Vault secret in this database. The database holds ciphertext only. (The older payout
-- encryption, 0723, keeps its key in this database's Vault; the owner asked for a key apart from the DB login here.)
--
-- Roll-back: drizzle/down/0730_dpdp_audit_trail.down.sql (drops everything this file creates; the audit rows go with it -- do not run it on a database whose audit rows matter).
--
-- Conventions: functions in `public` (the only schema PostgREST exposes), SECURITY DEFINER, search_path = '', execute granted to service_role (and app_runtime for the
-- append); refusals raise 42501, caller mistakes 22023. Dates are UTC.

-- ---------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------
create or replace function dpdp.audit_today_utc()
returns date
language sql stable
set search_path = ''
as $$ select (clock_timestamp() at time zone 'UTC')::date $$;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Per-organisation policy: the legal hold (suspends the 365-day deletion) and the head(s) of department who may download the organisation's whole (masked) log.
create table if not exists dpdp.audit_org_policy (
  org_id text primary key,
  legal_hold boolean not null default false,
  legal_hold_reason text,
  legal_hold_set_by text,
  legal_hold_set_at timestamptz,
  hod_identity_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Where each organisation's chain continues after a purge: the row_hash of the last deleted row. The first remaining row's prev_hash equals it.
create table if not exists dpdp.audit_chain_anchor (
  org_id text primary key,
  anchor_hash text not null,
  through_seq bigint not null,
  updated_at timestamptz not null default now()
);

create table if not exists dpdp.audit_event (
  seq bigint generated always as identity primary key,
  id text not null unique,
  org_id text not null,
  event_type text not null,
  actor_user_id text,
  actor_type text not null,
  actor_role text,
  target_table text,
  target_id text,
  request_id text,
  ai_call_id text,
  ref_hash text,
  server_time_us bigint not null,
  occurred_at timestamptz not null,
  created_day date not null,
  content_canonical text not null,
  content_hash text not null,
  prev_hash text not null,
  row_hash text not null unique,
  constraint audit_event_type_ok check (event_type in (
    'login', 'failed_login', 'create', 'edit', 'delete', 'publish', 'download_export', 'read_personal_data', 'consent', 'erasure', 'denied',
    'ai_read', 'ai_prepare', 'human_confirm', 'staff_read', 'legal_hold', 'retention'
  )),
  constraint audit_event_actor_type_ok check (actor_type in ('human', 'ai_link', 'system')),
  -- No two rows of one organisation may follow the same predecessor: a fork is refused by the database, not just detected later.
  constraint audit_event_no_fork unique (org_id, prev_hash)
);
create index if not exists audit_event_org_seq_idx on dpdp.audit_event (org_id, seq);
create index if not exists audit_event_actor_idx on dpdp.audit_event (org_id, actor_user_id, seq);
create index if not exists audit_event_day_idx on dpdp.audit_event (org_id, created_day);
create index if not exists audit_event_request_idx on dpdp.audit_event (request_id) where request_id is not null;
create index if not exists audit_event_ref_hash_idx on dpdp.audit_event (ref_hash) where ref_hash is not null;

-- Every INTERNAL read of full values: who, why, when, how much. Written BEFORE the values are opened; completed once afterwards.
create table if not exists dpdp.audit_access_log (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null,
  staff_email text not null,
  scope text not null,
  reason text not null,
  filters jsonb,
  rows_returned integer,
  at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists audit_access_log_org_idx on dpdp.audit_access_log (org_id, at desc);

-- One row per organisation per UTC day: the chain head at the end of that day. Also e-mailed to the owner (hash only).
create table if not exists dpdp.audit_chain_head_daily (
  org_id text not null,
  head_date date not null,
  head_hash text not null,
  row_count bigint not null,
  last_seq bigint not null,
  recorded_at timestamptz not null default now(),
  emailed_at timestamptz,
  primary key (org_id, head_date)
);

-- The day-335 notice is sent once per organisation per row-day.
create table if not exists dpdp.audit_notice_sent (
  org_id text not null,
  row_day date not null,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0,
  primary key (org_id, row_day)
);

-- Who was sent a day-335 notice and when (by hash of the lower-cased address, never the address): a person is mailed at most once in 7 days however many day-batches
-- of their log fall due, so a busy account is not mailed every day for a year.
create table if not exists dpdp.audit_notice_recipient (
  org_id text not null,
  email_hash text not null,
  last_sent timestamptz not null default now(),
  primary key (org_id, email_hash)
);

-- KEPT FOR EVER (with the certificates): anonymised counts only -- per organisation, day, event type, role and kind of actor. No identifier of any person.
create table if not exists dpdp.audit_stats_daily (
  org_id text not null,
  day date not null,
  event_type text not null,
  actor_role text not null,
  actor_type text not null,
  n bigint not null,
  primary key (org_id, day, event_type, actor_role, actor_type)
);

-- KEPT FOR EVER: the proof that a stretch of the log was deleted on schedule and what the chain looked like at that point.
create table if not exists dpdp.audit_deletion_certificate (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null,
  deleted_through_day date not null,
  deleted_at timestamptz not null default now(),
  row_count bigint not null,
  first_seq bigint not null,
  last_seq bigint not null,
  final_chain_hash text not null,
  certificate_hash text not null
);
create index if not exists audit_deletion_certificate_org_idx on dpdp.audit_deletion_certificate (org_id, deleted_at desc);

-- A failed attempt to write an audit row from a trigger (the business action is never blocked by an audit fault; the fault is recorded here and counted in the daily job).
create table if not exists dpdp.audit_failure (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text,
  error text
);

-- ---------------------------------------------------------------------
-- 2. The chain trigger (the only way a row gets its id, time, links and hashes)
-- ---------------------------------------------------------------------
create or replace function dpdp.audit_event_chain()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_c jsonb;
  v_prev text;
  v_last_us bigint;
  v_us bigint;
begin
  begin
    v_c := new.content_canonical::jsonb;
  exception when others then
    raise exception 'dpdp.audit_event: content_canonical is not valid JSON' using errcode = '22023';
  end;
  if jsonb_typeof(v_c) <> 'object' or coalesce(v_c ->> 'org_id', '') = '' or coalesce(v_c ->> 'event_type', '') = '' then
    raise exception 'dpdp.audit_event: content must be a JSON object with org_id and event_type' using errcode = '22023';
  end if;
  new.org_id := v_c ->> 'org_id';
  new.event_type := v_c ->> 'event_type';
  new.actor_user_id := nullif(v_c #>> '{actor,user_id}', '');
  new.actor_type := coalesce(v_c #>> '{actor,type}', '');
  new.actor_role := nullif(v_c #>> '{actor,role}', '');
  new.target_table := nullif(v_c #>> '{target,table}', '');
  new.target_id := nullif(v_c #>> '{target,id}', '');
  new.request_id := nullif(v_c ->> 'request_id', '');

  perform pg_advisory_xact_lock(hashtextextended('dpdp.audit:' || new.org_id, 0));
  select e.row_hash, e.server_time_us into v_prev, v_last_us from dpdp.audit_event e where e.org_id = new.org_id order by e.seq desc limit 1;
  if v_prev is null then
    select a.anchor_hash into v_prev from dpdp.audit_chain_anchor a where a.org_id = new.org_id;
  end if;
  v_prev := coalesce(v_prev, repeat('0', 64));

  v_us := floor(extract(epoch from clock_timestamp()) * 1000000)::bigint;
  if v_last_us is not null and v_us <= v_last_us then
    v_us := v_last_us + 1; -- the clock never runs backwards inside one organisation's chain
  end if;

  new.id := replace(gen_random_uuid()::text, '-', '');
  new.server_time_us := v_us;
  new.occurred_at := to_timestamp(v_us / 1000000.0);
  new.created_day := (new.occurred_at at time zone 'UTC')::date;
  new.content_hash := encode(sha256(convert_to(new.content_canonical, 'UTF8')), 'hex');
  new.prev_hash := v_prev;
  new.row_hash := encode(sha256(convert_to(v_prev || '|' || new.content_hash || '|' || new.id || '|' || new.org_id || '|' || v_us::text, 'UTF8')), 'hex');
  return new;
end
$$;

drop trigger if exists audit_event_chain on dpdp.audit_event;
create trigger audit_event_chain before insert on dpdp.audit_event
  for each row execute function dpdp.audit_event_chain();

-- ---------------------------------------------------------------------
-- 3. Append-only guards
-- ---------------------------------------------------------------------
create or replace function dpdp.audit_event_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The single permitted removal: the purge function sets this for its own transaction. Even then the row must be 365 days old and its organisation must not be on legal hold.
  if tg_op = 'DELETE' and coalesce(current_setting('dpdp.audit_purge', true), '') = 'on' then
    if old.created_day > dpdp.audit_today_utc() - 365 then
      raise exception 'dpdp.audit_event: a row younger than 365 days cannot be deleted' using errcode = '42501';
    end if;
    if exists (select 1 from dpdp.audit_org_policy p where p.org_id = old.org_id and p.legal_hold) then
      raise exception 'dpdp.audit_event: this organisation is on legal hold; nothing is deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  raise exception 'dpdp.audit_event is append-only' using errcode = '42501';
end
$$;
drop trigger if exists audit_event_guard on dpdp.audit_event;
create trigger audit_event_guard before update or delete on dpdp.audit_event
  for each row execute function dpdp.audit_event_guard();

create or replace function dpdp.audit_block_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; TRUNCATE is refused', tg_table_name using errcode = '42501';
end
$$;
drop trigger if exists audit_event_no_truncate on dpdp.audit_event;
create trigger audit_event_no_truncate before truncate on dpdp.audit_event for each statement execute function dpdp.audit_block_truncate();

create or replace function dpdp.audit_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end
$$;

-- The staff access log: completed once (rows_returned / finished_at), never altered or removed.
create or replace function dpdp.audit_access_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dpdp.audit_access_log is append-only' using errcode = '42501';
  end if;
  if old.finished_at is not null
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.staff_email is distinct from old.staff_email
     or new.scope is distinct from old.scope or new.reason is distinct from old.reason or new.filters is distinct from old.filters or new.at is distinct from old.at then
    raise exception 'dpdp.audit_access_log is append-only -- only rows_returned / finished_at may be set, once' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists audit_access_log_guard on dpdp.audit_access_log;
create trigger audit_access_log_guard before update or delete on dpdp.audit_access_log for each row execute function dpdp.audit_access_log_guard();
drop trigger if exists audit_access_log_no_truncate on dpdp.audit_access_log;
create trigger audit_access_log_no_truncate before truncate on dpdp.audit_access_log for each statement execute function dpdp.audit_block_truncate();

-- Daily heads: only emailed_at may be set, once.
create or replace function dpdp.audit_head_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dpdp.audit_chain_head_daily is append-only' using errcode = '42501';
  end if;
  if old.emailed_at is not null
     or new.org_id is distinct from old.org_id or new.head_date is distinct from old.head_date or new.head_hash is distinct from old.head_hash
     or new.row_count is distinct from old.row_count or new.last_seq is distinct from old.last_seq or new.recorded_at is distinct from old.recorded_at then
    raise exception 'dpdp.audit_chain_head_daily is append-only -- only emailed_at may be set, once' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists audit_head_guard on dpdp.audit_chain_head_daily;
create trigger audit_head_guard before update or delete on dpdp.audit_chain_head_daily for each row execute function dpdp.audit_head_guard();

-- Certificates and notices: insert-only.
drop trigger if exists audit_certificate_guard on dpdp.audit_deletion_certificate;
create trigger audit_certificate_guard before update or delete on dpdp.audit_deletion_certificate for each row execute function dpdp.audit_append_only_guard();
drop trigger if exists audit_notice_guard on dpdp.audit_notice_sent;
create trigger audit_notice_guard before update or delete on dpdp.audit_notice_sent for each row execute function dpdp.audit_append_only_guard();

-- ---------------------------------------------------------------------
-- 4. Privileges and row-level security.
--    The app role may INSERT audit rows (the chain trigger does the rest) and read NOTHING; no browser role has any grant. Everything else goes through the
--    SECURITY DEFINER functions below, executable by service_role only.
-- ---------------------------------------------------------------------
revoke all on table dpdp.audit_event, dpdp.audit_org_policy, dpdp.audit_chain_anchor, dpdp.audit_access_log, dpdp.audit_chain_head_daily, dpdp.audit_notice_sent,
  dpdp.audit_stats_daily, dpdp.audit_deletion_certificate, dpdp.audit_failure, dpdp.audit_notice_recipient from public, anon, authenticated;
revoke all on table dpdp.audit_event, dpdp.audit_org_policy, dpdp.audit_chain_anchor, dpdp.audit_access_log, dpdp.audit_chain_head_daily, dpdp.audit_notice_sent,
  dpdp.audit_stats_daily, dpdp.audit_deletion_certificate, dpdp.audit_failure, dpdp.audit_notice_recipient from app_runtime, service_role;
grant insert on table dpdp.audit_event to app_runtime, service_role;

alter table dpdp.audit_event enable row level security;
alter table dpdp.audit_org_policy enable row level security;
alter table dpdp.audit_chain_anchor enable row level security;
alter table dpdp.audit_access_log enable row level security;
alter table dpdp.audit_chain_head_daily enable row level security;
alter table dpdp.audit_notice_sent enable row level security;
alter table dpdp.audit_stats_daily enable row level security;
alter table dpdp.audit_deletion_certificate enable row level security;
alter table dpdp.audit_failure enable row level security;
alter table dpdp.audit_notice_recipient enable row level security;
do $$ begin
  create policy audit_event_insert on dpdp.audit_event for insert to app_runtime, service_role with check (true);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 5. In-database writer for the triggers (metadata only: never a personal value, because the seal key is not in this database)
-- ---------------------------------------------------------------------
create or replace function dpdp.audit_write(
  p_org text, p_event_type text, p_actor_type text, p_actor_user text, p_target_table text, p_target_id text,
  p_request_id text default null, p_link_id text default null, p_details jsonb default null, p_confirm jsonb default null, p_ai_call_id text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text;
  v_fp text;
  v_content jsonb;
begin
  begin
    if p_actor_user is not null and to_regclass('dpdp.membership') is not null then
      select m.level::text into v_role from dpdp.membership m where m.identity_id = p_actor_user and m.org_id = p_org order by (m.state = 'active') desc, m.created_at desc limit 1;
    end if;
    if p_link_id is not null and to_regclass('dpdp.ai_link') is not null then
      select left(l.token_hash, 12) into v_fp from dpdp.ai_link l where l.id = p_link_id;
    end if;
    v_content := jsonb_build_object(
      'v', 1, 'org_id', p_org, 'event_type', p_event_type, 'outcome', 'ok',
      'actor', jsonb_build_object('user_id', p_actor_user, 'role', v_role, 'type', p_actor_type, 'email', null),
      'target', case when p_target_table is null then null else jsonb_build_object('table', p_target_table, 'id', p_target_id) end,
      'changes', '[]'::jsonb, 'details', p_details, 'request_id', p_request_id,
      'link', case when p_link_id is null then null else jsonb_build_object('id', p_link_id, 'token_fp', v_fp) end,
      'confirm', p_confirm, 'ai_call_id', p_ai_call_id, 'origin', 'database'
    );
    insert into dpdp.audit_event (content_canonical, ai_call_id) values (v_content::text, p_ai_call_id);
  exception when others then
    begin
      insert into dpdp.audit_failure (source, error) values (p_target_table, left(sqlerrm, 300));
    exception when others then
      null;
    end;
  end;
end
$$;

create or replace function dpdp.audit_type_of_kind(p_kind text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_kind ~ '^consent_' then 'consent'
    when p_kind ~ '(erase|erasure)' then 'erasure'
    when p_kind ~ '(_revoked|_removed|_deleted|_withdrawn)$' then 'delete'
    when p_kind ~ '(_created|_joined|_added|_earned|_made)$' or p_kind ~ '^organisation_created' then 'create'
    when p_kind ~ '(published|share_press)' then 'publish'
    else 'edit'
  end
$$;

create or replace function dpdp.audit_from_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- These two are logged with full AI attribution by the ai_action / ai_draft triggers below; mirroring them here would double-count.
  if new.kind in ('ai_action_applied', 'ai_draft_confirmed') then
    return new;
  end if;
  perform dpdp.audit_write(new.org_id, dpdp.audit_type_of_kind(new.kind), case when new.actor_identity_id is null then 'system' else 'human' end,
    new.actor_identity_id, 'dpdp.event', new.id, null, null, jsonb_build_object('kind', new.kind));
  return new;
end
$$;

create or replace function dpdp.audit_from_ai_action()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_identity text;
begin
  select m.identity_id into v_identity from dpdp.membership m where m.id = new.membership_id;
  perform dpdp.audit_write(new.org_id, 'edit', 'ai_link', v_identity, 'dpdp.obligation', new.obligation_id, new.id, new.link_id,
    jsonb_build_object('verb', new.verb, 'level', 1, 'via', 'ai_work_link'));
  return new;
end
$$;

create or replace function dpdp.audit_from_ai_draft_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_identity text;
begin
  select m.identity_id into v_identity from dpdp.membership m where m.id = new.membership_id;
  perform dpdp.audit_write(new.org_id, 'ai_prepare', 'ai_link', v_identity, 'dpdp.ai_draft', new.id, new.id, new.ai_link_id,
    jsonb_build_object('verb', new.verb, 'obligation_id', new.obligation_id));
  return new;
end
$$;

create or replace function dpdp.audit_from_ai_draft_confirm()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform dpdp.audit_write(new.org_id, 'human_confirm', 'human', new.confirmed_by, 'dpdp.ai_draft', new.id, new.id, new.ai_link_id,
    jsonb_build_object('verb', new.verb, 'obligation_id', new.obligation_id),
    jsonb_build_object('link_id', new.ai_link_id, 'clicked_by_user_id', new.confirmed_by, 'clicked_at', new.confirmed_at));
  return new;
end
$$;

do $$
begin
  if to_regclass('dpdp.event') is not null then
    drop trigger if exists audit_from_event on dpdp.event;
    create trigger audit_from_event after insert on dpdp.event for each row execute function dpdp.audit_from_event();
  end if;
  if to_regclass('dpdp.ai_action') is not null then
    drop trigger if exists audit_from_ai_action on dpdp.ai_action;
    create trigger audit_from_ai_action after insert on dpdp.ai_action for each row execute function dpdp.audit_from_ai_action();
  end if;
  if to_regclass('dpdp.ai_draft') is not null then
    drop trigger if exists audit_from_ai_draft_insert on dpdp.ai_draft;
    create trigger audit_from_ai_draft_insert after insert on dpdp.ai_draft for each row execute function dpdp.audit_from_ai_draft_insert();
    drop trigger if exists audit_from_ai_draft_confirm on dpdp.ai_draft;
    create trigger audit_from_ai_draft_confirm after update of confirmed_at on dpdp.ai_draft for each row
      when (old.confirmed_at is null and new.confirmed_at is not null) execute function dpdp.audit_from_ai_draft_confirm();
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Functions for the Edge Functions (service_role only; the browser never calls these)
-- ---------------------------------------------------------------------

-- The one write path from an Edge Function: content_canonical in, {id, seq, rowHash, orgId} out.
create or replace function public.dpdp_audit_append(p_content text, p_ai_call_id text default null, p_ref_hash text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_row dpdp.audit_event;
begin
  insert into dpdp.audit_event (content_canonical, ai_call_id, ref_hash)
  values (p_content, left(p_ai_call_id, 120), left(p_ref_hash, 64))
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'seq', v_row.seq, 'rowHash', v_row.row_hash, 'orgId', v_row.org_id);
end
$$;

-- Who is this signed-in e-mail? Identity, active memberships (with HOD flag), and whether it is the platform owner. Lookup logic = dpdp__caller_identity_id (0604), by e-mail.
create or replace function public.dpdp_audit_resolve_caller(p_email text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_memberships jsonb;
  v_owner boolean;
begin
  select ie.identity_id into v_identity from dpdp.identity_email ie where lower(ie.email) = lower(coalesce(p_email, '')) order by ie.is_primary desc limit 1;
  v_owner := exists (select 1 from dpdp.platform_admin a where lower(a.email) = lower(coalesce(p_email, '')));
  if v_identity is null then
    return jsonb_build_object('identityId', null, 'memberships', '[]'::jsonb, 'isPlatformOwner', v_owner);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'orgId', m.org_id, 'orgName', o.name, 'level', m.level::text,
      'hod', exists (select 1 from dpdp.audit_org_policy p where p.org_id = m.org_id and v_identity = any (p.hod_identity_ids))
    ) order by m.created_at desc), '[]'::jsonb)
  into v_memberships
  from dpdp.membership m left join dpdp.organisation o on o.id = m.org_id
  where m.identity_id = v_identity and m.state = 'active';
  return jsonb_build_object('identityId', v_identity, 'memberships', v_memberships, 'isPlatformOwner', v_owner);
end
$$;

-- For an AI-link call: the organisation, the person the link acts for, and the (already hashed) token fingerprint. No token is ever read or returned.
create or replace function public.dpdp_audit_link_context(p_link_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_l dpdp.ai_link; v_role text;
begin
  select l.* into v_l from dpdp.ai_link l where l.id = p_link_id;
  if v_l.id is null then
    return jsonb_build_object('found', false);
  end if;
  select m.level::text into v_role from dpdp.membership m where m.id = v_l.membership_id;
  return jsonb_build_object('found', true, 'orgId', v_l.org_id, 'identityId', v_l.identity_id, 'role', v_role, 'tokenFp', left(v_l.token_hash, 12), 'level', v_l.authority_level);
end
$$;

-- Rows in chain order, optionally one person's only. Returns what verify needs, nothing is opened.
create or replace function public.dpdp_audit_fetch(
  p_org text, p_actor text default null, p_after_seq bigint default 0, p_limit integer default 1000, p_from timestamptz default null, p_to timestamptz default null
)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.seq), '[]'::jsonb)
  from (
    select e.seq, e.id, e.org_id, e.event_type, e.actor_user_id, e.server_time_us, e.content_canonical, e.content_hash, e.prev_hash, e.row_hash
    from dpdp.audit_event e
    where e.org_id = p_org and e.seq > coalesce(p_after_seq, 0)
      and (p_actor is null or e.actor_user_id = p_actor)
      and (p_from is null or e.occurred_at >= p_from)
      and (p_to is null or e.occurred_at < p_to)
    order by e.seq
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000)
  ) r
$$;

create or replace function public.dpdp_audit_chain_state(p_org text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'anchor', coalesce((select a.anchor_hash from dpdp.audit_chain_anchor a where a.org_id = p_org), repeat('0', 64)),
    'anchorSeq', coalesce((select a.through_seq from dpdp.audit_chain_anchor a where a.org_id = p_org), 0),
    'head', (select e.row_hash from dpdp.audit_event e where e.org_id = p_org order by e.seq desc limit 1),
    'lastSeq', (select max(e.seq) from dpdp.audit_event e where e.org_id = p_org),
    'rows', (select count(*) from dpdp.audit_event e where e.org_id = p_org),
    'legalHold', coalesce((select p.legal_hold from dpdp.audit_org_policy p where p.org_id = p_org), false)
  )
$$;

-- Download rate limit: how many exports this person has made (or tried) since a moment.
create or replace function public.dpdp_audit_count_exports(p_org text, p_actor text, p_since timestamptz)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(*)::integer from dpdp.audit_event e
  where e.org_id = p_org and e.actor_user_id = p_actor and e.event_type = 'download_export' and e.occurred_at >= p_since
$$;

-- The daily heads already recorded for an organisation (newest first): "verify chain" checks each one is still in the chain, which catches the removal of the newest rows.
create or replace function public.dpdp_audit_recorded_heads(p_org text, p_limit integer default 400)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(h) order by h.head_date desc), '[]'::jsonb)
  from (select c.head_date, c.head_hash, c.last_seq, c.row_count from dpdp.audit_chain_head_daily c where c.org_id = p_org order by c.head_date desc limit least(greatest(coalesce(p_limit, 400), 1), 1000)) h
$$;

-- Generic recent-activity count for one person and one event type (rate limits: failed-login ingestion, exports).
create or replace function public.dpdp_audit_count_recent(p_org text, p_actor text, p_type text, p_since timestamptz)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(*)::integer from dpdp.audit_event e
  where e.org_id = p_org and e.actor_user_id = p_actor and e.event_type = p_type and e.occurred_at >= p_since
$$;

-- "Is this file one we issued?": the export event that carries this verification hash.
create or replace function public.dpdp_audit_find_export(p_hash text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select jsonb_build_object('found', true, 'orgId', e.org_id, 'issuedAt', e.occurred_at, 'rowHash', e.row_hash, 'actorUserId', e.actor_user_id)
                   from dpdp.audit_event e where e.event_type = 'download_export' and e.ref_hash = p_hash order by e.seq limit 1),
                  jsonb_build_object('found', false))
$$;

-- Item 5: record each organisation's chain head for a UTC day; list the ones to e-mail (only if the chain moved since the last recorded head).
create or replace function public.dpdp_audit_record_heads(p_day date default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, dpdp.audit_today_utc() - 1);
  v_out jsonb := '[]'::jsonb;
  r record;
  v_prev_seq bigint;
  v_item jsonb;
begin
  for r in
    select e.org_id,
           (array_agg(e.row_hash order by e.seq desc))[1] as head_hash,
           max(e.seq) as last_seq,
           count(*) as n
    from dpdp.audit_event e
    where e.created_day <= v_day
    group by e.org_id
  loop
    select h.last_seq into v_prev_seq from dpdp.audit_chain_head_daily h where h.org_id = r.org_id and h.head_date < v_day order by h.head_date desc limit 1;
    insert into dpdp.audit_chain_head_daily (org_id, head_date, head_hash, row_count, last_seq)
    values (r.org_id, v_day, r.head_hash, r.n, r.last_seq)
    on conflict (org_id, head_date) do nothing;
    if v_prev_seq is not null and v_prev_seq = r.last_seq then
      -- Nothing new since the previous recorded head: recorded, not e-mailed.
      update dpdp.audit_chain_head_daily set emailed_at = now() where org_id = r.org_id and head_date = v_day and emailed_at is null;
    end if;
    select jsonb_build_object(
      'orgId', h.org_id, 'orgName', (select o.name from dpdp.organisation o where o.id = h.org_id), 'headDate', h.head_date, 'headHash', h.head_hash,
      'rowCount', h.row_count, 'lastSeq', h.last_seq,
      'ownerEmails', coalesce((select jsonb_agg(distinct i.primary_email) from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
                               where m.org_id = h.org_id and m.state = 'active' and m.level::text = 'owner'), '[]'::jsonb)
    ) into v_item
    from dpdp.audit_chain_head_daily h where h.org_id = r.org_id and h.head_date = v_day and h.emailed_at is null;
    if v_item is not null then
      v_out := v_out || jsonb_build_array(v_item);
    end if;
  end loop;
  return jsonb_build_object('day', v_day, 'heads', v_out, 'failures', (select count(*) from dpdp.audit_failure f where f.at >= now() - interval '1 day'));
end
$$;

create or replace function public.dpdp_audit_mark_head_emailed(p_org text, p_day date)
returns void
language sql security definer
set search_path = ''
as $$
  update dpdp.audit_chain_head_daily set emailed_at = now() where org_id = p_org and head_date = p_day and emailed_at is null
$$;

-- Item 6: which day-batches need the day-335 notice, and which organisations have rows ready to delete.
create or replace function dpdp.audit_purge_through(p_org text, p_today date)
returns date
language sql stable
set search_path = ''
as $$
  with d as (
    select e.created_day as day, (p_today - e.created_day) as age,
           exists (select 1 from dpdp.audit_notice_sent s where s.org_id = p_org and s.row_day = e.created_day) as noticed
    from dpdp.audit_event e where e.org_id = p_org group by e.created_day
  ), blocked as (
    -- an expired day whose notice never went out is held for up to 30 more days (a missed notice must not shorten the download window)
    select min(day) as day from d where age >= 365 and age < 395 and not noticed
  )
  select case
    when exists (select 1 from dpdp.audit_org_policy p where p.org_id = p_org and p.legal_hold) then null
    else (select max(d.day) from d where d.age >= 365 and d.day < coalesce((select b.day from blocked b), 'infinity'::date))
  end
$$;

create or replace function public.dpdp_audit_lifecycle_plan(p_today date default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, dpdp.audit_today_utc());
  v_notices jsonb;
  v_purges jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'orgId', due.org_id, 'orgName', (select o.name from dpdp.organisation o where o.id = due.org_id), 'rowDay', due.day, 'ageDays', due.age,
      'purgeOn', due.day + 365, 'rows', due.n,
      'recipients', (
        select coalesce(jsonb_agg(distinct x.email), '[]'::jsonb) from (
          select i.primary_email as email from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
            where m.org_id = due.org_id and m.state = 'active' and m.level::text = 'owner'
          union
          select i.primary_email from dpdp.audit_org_policy p cross join lateral unnest(p.hod_identity_ids) as h(id) join dpdp.identity i on i.id = h.id
            where p.org_id = due.org_id
          union
          select i.primary_email from dpdp.audit_event e join dpdp.identity i on i.id = e.actor_user_id
            where e.org_id = due.org_id and e.created_day = due.day
        ) x where x.email is not null
          and not exists (select 1 from dpdp.audit_notice_recipient r
                          where r.org_id = due.org_id and r.email_hash = encode(sha256(convert_to(lower(x.email), 'UTF8')), 'hex') and r.last_sent > now() - interval '7 days'))
    ) order by due.org_id, due.day), '[]'::jsonb)
  into v_notices
  from (
    select e.org_id, e.created_day as day, (v_today - e.created_day) as age, count(*) as n
    from dpdp.audit_event e
    group by e.org_id, e.created_day
  ) due
  where due.age between 335 and 364
    and not exists (select 1 from dpdp.audit_notice_sent s where s.org_id = due.org_id and s.row_day = due.day)
    and not exists (select 1 from dpdp.audit_org_policy p where p.org_id = due.org_id and p.legal_hold);

  select coalesce(jsonb_agg(jsonb_build_object('orgId', t.org_id, 'throughDay', t.through) order by t.org_id), '[]'::jsonb)
  into v_purges
  from (select o.org_id, dpdp.audit_purge_through(o.org_id, v_today) as through from (select distinct e.org_id from dpdp.audit_event e) o) t
  where t.through is not null;

  return jsonb_build_object('today', v_today, 'notices', v_notices, 'purges', v_purges,
    'held', coalesce((select jsonb_agg(p.org_id) from dpdp.audit_org_policy p where p.legal_hold), '[]'::jsonb));
end
$$;

create or replace function public.dpdp_audit_mark_notice_sent(p_org text, p_row_day date, p_recipients integer default 0, p_emails text[] default '{}')
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into dpdp.audit_notice_sent (org_id, row_day, recipients) values (p_org, p_row_day, coalesce(p_recipients, 0)) on conflict do nothing;
  insert into dpdp.audit_notice_recipient (org_id, email_hash, last_sent)
  select p_org, encode(sha256(convert_to(lower(e), 'UTF8')), 'hex'), now() from unnest(coalesce(p_emails, '{}')) e
  on conflict (org_id, email_hash) do update set last_sent = excluded.last_sent;
end
$$;

-- The deletion: anonymised statistics first, then the certificate, then the anchor, then the rows (a prefix of the chain). One transaction; any failure leaves everything as it was.
create or replace function public.dpdp_audit_purge(p_org text, p_through_day date default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := dpdp.audit_today_utc();
  v_allowed date;
  v_through date;
  v_first_keep bigint;
  v_last bigint;
  v_first bigint;
  v_final text;
  v_count bigint;
  v_cert dpdp.audit_deletion_certificate;
  v_chash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('dpdp.audit:' || p_org, 0));
  v_allowed := dpdp.audit_purge_through(p_org, v_today);
  if v_allowed is null then
    return jsonb_build_object('purged', false, 'reason', 'nothing is due, or the organisation is on legal hold');
  end if;
  v_through := least(coalesce(p_through_day, v_allowed), v_allowed);

  select min(e.seq) into v_first_keep from dpdp.audit_event e where e.org_id = p_org and e.created_day > v_through;
  select max(e.seq) into v_last from dpdp.audit_event e where e.org_id = p_org and (v_first_keep is null or e.seq < v_first_keep);
  if v_last is null then
    return jsonb_build_object('purged', false, 'reason', 'no rows');
  end if;
  select min(e.seq), count(*) into v_first, v_count from dpdp.audit_event e where e.org_id = p_org and e.seq <= v_last;
  select e.row_hash into v_final from dpdp.audit_event e where e.org_id = p_org and e.seq = v_last;

  insert into dpdp.audit_stats_daily (org_id, day, event_type, actor_role, actor_type, n)
  select e.org_id, e.created_day, e.event_type, coalesce(e.actor_role, 'none'), e.actor_type, count(*)
  from dpdp.audit_event e where e.org_id = p_org and e.seq <= v_last
  group by e.org_id, e.created_day, e.event_type, coalesce(e.actor_role, 'none'), e.actor_type
  on conflict (org_id, day, event_type, actor_role, actor_type) do update set n = dpdp.audit_stats_daily.n + excluded.n;

  v_chash := encode(sha256(convert_to(p_org || '|' || v_through::text || '|' || v_count::text || '|' || v_first::text || '|' || v_last::text || '|' || v_final, 'UTF8')), 'hex');
  insert into dpdp.audit_deletion_certificate (org_id, deleted_through_day, row_count, first_seq, last_seq, final_chain_hash, certificate_hash)
  values (p_org, v_through, v_count, v_first, v_last, v_final, v_chash) returning * into v_cert;

  insert into dpdp.audit_chain_anchor (org_id, anchor_hash, through_seq) values (p_org, v_final, v_last)
  on conflict (org_id) do update set anchor_hash = excluded.anchor_hash, through_seq = excluded.through_seq, updated_at = now();

  perform set_config('dpdp.audit_purge', 'on', true);
  delete from dpdp.audit_event e where e.org_id = p_org and e.seq <= v_last;
  perform set_config('dpdp.audit_purge', 'off', true);

  perform dpdp.audit_write(p_org, 'retention', 'system', null, 'dpdp.audit_deletion_certificate', v_cert.id, null, null,
    jsonb_build_object('rows_deleted', v_count, 'through_day', v_through, 'certificate_hash', v_chash));
  return jsonb_build_object('purged', true, 'certificateId', v_cert.id, 'orgId', p_org, 'throughDay', v_through, 'rows', v_count, 'finalChainHash', v_final, 'certificateHash', v_chash);
end
$$;

-- Legal hold (platform owner only) and head-of-department list (that organisation's own owner only). Both leave an audit row.
create or replace function public.dpdp_audit_set_legal_hold(p_email text, p_org text, p_hold boolean, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_identity text;
begin
  if not exists (select 1 from dpdp.platform_admin a where lower(a.email) = lower(coalesce(p_email, ''))) then
    raise exception 'Only the platform owner may set a legal hold' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'A legal hold needs a reason of at least 10 characters' using errcode = '22023';
  end if;
  insert into dpdp.audit_org_policy (org_id, legal_hold, legal_hold_reason, legal_hold_set_by, legal_hold_set_at)
  values (p_org, p_hold, left(p_reason, 500), 'platform-owner', now())
  on conflict (org_id) do update set legal_hold = excluded.legal_hold, legal_hold_reason = excluded.legal_hold_reason, legal_hold_set_by = excluded.legal_hold_set_by,
    legal_hold_set_at = excluded.legal_hold_set_at, updated_at = now();
  select ie.identity_id into v_identity from dpdp.identity_email ie where lower(ie.email) = lower(p_email) order by ie.is_primary desc limit 1;
  perform dpdp.audit_write(p_org, 'legal_hold', 'human', v_identity, 'dpdp.audit_org_policy', p_org, null, null, jsonb_build_object('legal_hold', p_hold));
  return jsonb_build_object('orgId', p_org, 'legalHold', p_hold);
end
$$;

create or replace function public.dpdp_audit_set_hod(p_email text, p_org text, p_identity_ids text[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_identity text;
begin
  select ie.identity_id into v_identity from dpdp.identity_email ie where lower(ie.email) = lower(coalesce(p_email, '')) order by ie.is_primary desc limit 1;
  if v_identity is null or not exists (select 1 from dpdp.membership m where m.identity_id = v_identity and m.org_id = p_org and m.state = 'active' and m.level::text = 'owner') then
    raise exception 'Only an owner of this organisation may name who can download its whole audit log' using errcode = '42501';
  end if;
  insert into dpdp.audit_org_policy (org_id, hod_identity_ids)
  values (p_org, coalesce((select array_agg(distinct i) from unnest(p_identity_ids) i where exists (select 1 from dpdp.membership m where m.identity_id = i and m.org_id = p_org and m.state = 'active')), '{}'))
  on conflict (org_id) do update set hod_identity_ids = excluded.hod_identity_ids, updated_at = now();
  perform dpdp.audit_write(p_org, 'edit', 'human', v_identity, 'dpdp.audit_org_policy', p_org, null, null, jsonb_build_object('field', 'hod_identity_ids'));
  return jsonb_build_object('orgId', p_org, 'hod', (select p.hod_identity_ids from dpdp.audit_org_policy p where p.org_id = p_org));
end
$$;

-- Item 3: an internal read of full values. The access-log row is written FIRST; the caller opens values only if this returns an id. Platform owner only, reason required.
create or replace function public.dpdp_audit_staff_begin(p_email text, p_org text, p_scope text, p_reason text, p_filters jsonb default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare v_id text;
begin
  if not exists (select 1 from dpdp.platform_admin a where lower(a.email) = lower(coalesce(p_email, ''))) then
    raise exception 'Only the platform owner may read full audit values' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'A reason of at least 10 characters is required to read full audit values' using errcode = '22023';
  end if;
  insert into dpdp.audit_access_log (org_id, staff_email, scope, reason, filters)
  values (coalesce(p_org, '*'), lower(p_email), left(coalesce(p_scope, 'rows'), 40), left(p_reason, 500), p_filters)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.dpdp_audit_staff_finish(p_log_id text, p_rows integer)
returns void
language sql security definer
set search_path = ''
as $$
  update dpdp.audit_access_log set rows_returned = p_rows, finished_at = now() where id = p_log_id and finished_at is null
$$;

-- ---------------------------------------------------------------------
-- 7. Execute grants: service_role only (append also to app_runtime, like the other dpdp_* writers)
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'dpdp_audit_append(text, text, text)', 'dpdp_audit_resolve_caller(text)', 'dpdp_audit_link_context(text)',
    'dpdp_audit_fetch(text, text, bigint, integer, timestamptz, timestamptz)', 'dpdp_audit_chain_state(text)', 'dpdp_audit_count_exports(text, text, timestamptz)', 'dpdp_audit_count_recent(text, text, text, timestamptz)', 'dpdp_audit_recorded_heads(text, integer)',
    'dpdp_audit_find_export(text)', 'dpdp_audit_record_heads(date)', 'dpdp_audit_mark_head_emailed(text, date)', 'dpdp_audit_lifecycle_plan(date)',
    'dpdp_audit_mark_notice_sent(text, date, integer, text[])', 'dpdp_audit_purge(text, date)', 'dpdp_audit_set_legal_hold(text, text, boolean, text)',
    'dpdp_audit_set_hod(text, text, text[])', 'dpdp_audit_staff_begin(text, text, text, text, jsonb)', 'dpdp_audit_staff_finish(text, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;
grant execute on function public.dpdp_audit_append(text, text, text) to app_runtime;

-- ---------------------------------------------------------------------
-- 8. Daily job (00:20 UTC): record + e-mail the chain heads, send the day-335 notices, run the day-365 deletion. Same request shape as dpdp-operator-digest (0667):
--    the bearer is the Vault secret dpdp_timer_secret; the URL is the Vault secret dpdp_timer_url with the function name swapped. cron.schedule upserts by name.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-audit-daily',
      '20 0 * * *',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-audit-lifecycle'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"audit_daily"}'::jsonb,
          timeout_milliseconds := 120000
        )
      $cron$
    );
  end if;
end
$$;
