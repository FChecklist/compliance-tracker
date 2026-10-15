-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved Test/Live mode and the account-info changes for veridian-aios.com in chat on 2026-10-06
--
-- DPDP Test / Live mode, the offer end date, and self-declared firm / institution information.
-- NOT applied live by the session that wrote it; the PM applies it after CI is green. Built on 0731 (audit trail), 0733 (visitor journey) and 0734 (account, plans, billing).
--
-- A. TEST / LIVE MODE (one row; only the platform owner changes it; every change is written to the append-only dpdp.audit_platform_event)
--      public.dpdp_platform_mode()          anyone may read (the site banner and /api/mode); returns {mode, test}
--      public.dpdp_owner_set_mode(mode, reason)   owner only, not callable by anon or service_role (so not by the AI link)
--    In TEST mode:
--      * every organisation / identity created is flagged in dpdp.test_org / dpdp.test_identity (and account.is_test, payment.is_test, visit_session.is_test)
--      * every outbound e-mail from every Edge Function asks public.dpdp_mail_gate(): only addresses on the owner-managed dpdp.mail_allowlist are sent to
--        (default: the platform owner); the rest are suppressed and logged as suppressed_test_mode (a hash of the address, never the address)
--      * public.dpdp_test_payment(): a clearly labelled test payment that moves paid-until through the SAME confirmed-payment path, never touching Razorpay;
--        it refuses in LIVE mode and on any account that is not a test account
--      * test data earns no commission and sends no partner notice; it is left out of the visitor report, the funnel, the billing e-mail worklist and the
--        owner's pending-claims list (reports take a mode filter, default live)
--      * public.dpdp_owner_purge_test_data(): owner only, deletes every test organisation and its data, NEVER the audit rows; records a purge event
--    In LIVE mode nothing changes for real people. A test account's contacts are never e-mailed in LIVE mode either (the gate also suppresses test identities).
--
-- B. THE OFFER END DATE is nulled for every plan and is never shown anywhere. The column stays; the owner sets it with public.dpdp_owner_set_offer_end() and
--    the value lives only in the database (the audit row says an end date changed, never what it is). A NULL end date with a start date means the offer is on.
--
-- C. FIRM / INSTITUTION INFORMATION, SELF-DECLARED, NO MANUAL VERIFICATION. The owner-verifies-firms gate is gone. Everything on the opening page is optional
--    and never blocks: dpdp.account_profile holds it, public.dpdp_account_save_profile() saves it (invalid values are ignored and reported, never refused).
--    The free own-use firm plan (zero clients) is granted when the owner ticks "I am a practising CA / CS / cost accountant" (verification_status 'declared');
--    the membership number is optional and its FORMAT is checked per body for information only. The platform owner sees the declared firms and may downgrade one
--    to a paid plan (public.dpdp_owner_downgrade_firm, audited). plan.requires_verified keeps its name but now means 'needs the self-declaration'.

-- ---------------------------------------------------------------------
-- 1. Mode: one row, an append-only audit table
-- ---------------------------------------------------------------------
create table if not exists dpdp.platform_mode (
  id integer primary key default 1,
  mode text not null default 'LIVE' check (mode in ('TEST', 'LIVE')),
  changed_by text,
  changed_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  reason text,
  constraint platform_mode_single check (id = 1)
);
insert into dpdp.platform_mode (id) values (1) on conflict (id) do nothing;

create table if not exists dpdp.audit_platform_event (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  actor_identity_id text,
  detail jsonb not null default '{}'::jsonb
);

create or replace function dpdp.audit_platform_event_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The platform audit trail is append-only' using errcode = '42501';
end
$$;
drop trigger if exists audit_platform_event_no_change on dpdp.audit_platform_event;
create trigger audit_platform_event_no_change before update or delete on dpdp.audit_platform_event for each row execute function dpdp.audit_platform_event_guard();
drop trigger if exists audit_platform_event_no_truncate on dpdp.audit_platform_event;
create trigger audit_platform_event_no_truncate before truncate on dpdp.audit_platform_event for each statement execute function dpdp.audit_platform_event_guard();

create or replace function dpdp.platform_audit(p_kind text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor text;
begin
  begin
    v_actor := public.dpdp__caller_identity_id();
  exception when others then
    v_actor := null;
  end;
  insert into dpdp.audit_platform_event (kind, actor_identity_id, detail) values (p_kind, v_actor, coalesce(p_detail, '{}'::jsonb));
end
$$;

-- Every change of the mode is audited, whichever door it came through (the owner RPC below, or a direct update from the SQL console).
create or replace function dpdp.platform_mode_audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.mode is distinct from old.mode then
    perform dpdp.platform_audit('mode_switch', jsonb_build_object('from', old.mode, 'to', new.mode, 'reason', new.reason,
      'via', case when coalesce(current_setting('dpdp.mode_via_rpc', true), '') = 'on' then 'owner_rpc' else 'direct_sql' end));
  end if;
  return new;
end
$$;
drop trigger if exists platform_mode_audit on dpdp.platform_mode;
create trigger platform_mode_audit after update on dpdp.platform_mode for each row execute function dpdp.platform_mode_audit();

create or replace function dpdp.is_test_mode()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce((select m.mode = 'TEST' from dpdp.platform_mode m where m.id = 1), false) $$;

create or replace function public.dpdp_platform_mode()
returns jsonb
language sql stable security definer
set search_path = ''
as $$ select jsonb_build_object('mode', coalesce((select m.mode from dpdp.platform_mode m where m.id = 1), 'LIVE'), 'test', dpdp.is_test_mode()) $$;

create or replace function public.dpdp_owner_set_mode(p_mode text, p_reason text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_new text := upper(btrim(coalesce(p_mode, '')));
  v_old text;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if v_new not in ('TEST', 'LIVE') then
    raise exception 'mode must be TEST or LIVE' using errcode = '22023';
  end if;
  select m.mode into v_old from dpdp.platform_mode m where m.id = 1;
  if v_old = v_new then
    return jsonb_build_object('ok', true, 'mode', v_new, 'changed', false);
  end if;
  perform set_config('dpdp.mode_via_rpc', 'on', true);
  update dpdp.platform_mode
  set mode = v_new, changed_by = public.dpdp__caller_identity_id(), changed_at = (clock_timestamp() at time zone 'UTC'),
      reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  where id = 1;
  return jsonb_build_object('ok', true, 'mode', v_new, 'changed', true);
end
$$;

-- ---------------------------------------------------------------------
-- 2. The test registry and the flags
-- ---------------------------------------------------------------------
create table if not exists dpdp.test_org (
  org_id text primary key,
  flagged_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create table if not exists dpdp.test_identity (
  identity_id text primary key,
  flagged_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);

alter table dpdp.account add column if not exists is_test boolean not null default false;
alter table dpdp.payment add column if not exists is_test boolean not null default false;

create or replace function dpdp.org_is_test(p_org_id text)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from dpdp.test_org t where t.org_id = p_org_id) $$;

create or replace function dpdp.flag_test_org()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if dpdp.is_test_mode() then
    insert into dpdp.test_org (org_id) values (new.id) on conflict (org_id) do nothing;
  end if;
  return new;
end
$$;
drop trigger if exists flag_test_org on dpdp.organisation;
create trigger flag_test_org after insert on dpdp.organisation for each row execute function dpdp.flag_test_org();

create or replace function dpdp.flag_test_identity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if dpdp.is_test_mode() then
    insert into dpdp.test_identity (identity_id) values (new.id) on conflict (identity_id) do nothing;
  end if;
  return new;
end
$$;
drop trigger if exists flag_test_identity on dpdp.identity;
create trigger flag_test_identity after insert on dpdp.identity for each row execute function dpdp.flag_test_identity();

create or replace function dpdp.flag_test_account()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.is_test := new.is_test or dpdp.org_is_test(new.org_id);
  return new;
end
$$;
drop trigger if exists flag_test_account on dpdp.account;
create trigger flag_test_account before insert on dpdp.account for each row execute function dpdp.flag_test_account();

create or replace function dpdp.flag_test_payment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.is_test := new.is_test or dpdp.org_is_test(new.org_id) or coalesce(current_setting('dpdp.test_payment', true), '') = 'on';
  return new;
end
$$;
drop trigger if exists flag_test_payment on dpdp.payment;
create trigger flag_test_payment before insert on dpdp.payment for each row execute function dpdp.flag_test_payment();

-- A test organisation's sign-up never earns a referral credit.
create or replace function dpdp.flag_test_referral_event()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if dpdp.org_is_test(new.referred_org_id) then
    new.outcome := 'blocked';
    new.block_reason := 'test_mode';
    new.credit_months := 0;
  end if;
  return new;
end
$$;
drop trigger if exists flag_test_referral_event on dpdp.referral_event;
create trigger flag_test_referral_event before insert on dpdp.referral_event for each row execute function dpdp.flag_test_referral_event();

-- A test organisation's sign-up sends its sales partner no notice.
create or replace function dpdp.skip_test_partner_notice()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.kind = 'referred_signup' and dpdp.org_is_test(new.dedupe_key) then
    return null;
  end if;
  return new;
end
$$;
drop trigger if exists skip_test_partner_notice on dpdp.partner_notice;
create trigger skip_test_partner_notice before insert on dpdp.partner_notice for each row execute function dpdp.skip_test_partner_notice();

-- Visits made while the site is in TEST mode are flagged, so the visitor reports can leave them out.
alter table dpdp.visit_session add column if not exists is_test boolean not null default false;
create or replace function dpdp.flag_test_visit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.is_test := new.is_test or dpdp.is_test_mode();
  return new;
end
$$;
drop trigger if exists flag_test_visit on dpdp.visit_session;
create trigger flag_test_visit before insert on dpdp.visit_session for each row execute function dpdp.flag_test_visit();
create index if not exists visit_session_test_idx on dpdp.visit_session (is_test) where is_test;

-- ---------------------------------------------------------------------
-- 3. E-mail: the allowlist, the gate, the suppression log
-- ---------------------------------------------------------------------
create table if not exists dpdp.mail_allowlist (
  email_lower text primary key,
  note text,
  added_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint mail_allowlist_shape check (email_lower ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and email_lower = lower(email_lower))
);
insert into dpdp.mail_allowlist (email_lower, note)
select lower(pa.email), 'platform owner (default)' from dpdp.platform_admin pa where pa.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
on conflict (email_lower) do nothing;

create table if not exists dpdp.mail_suppressed_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null,
  reason text not null,
  to_hash text not null,
  to_domain text
);

-- THE rule, arguments only. The TypeScript copy (supabase/functions/_shared/mail-gate.ts decideMail) is compared with this one by a test.
create or replace function dpdp.mail_decision(p_test_mode boolean, p_allowlisted boolean, p_test_recipient boolean)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_test_mode then case when p_allowlisted then 'allowlisted' else 'suppressed_test_mode' end
    when p_test_recipient and not p_allowlisted then 'suppressed_test_account'
    else 'live'
  end
$$;

create or replace function public.dpdp_mail_gate(p_to text, p_source text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_to text := lower(btrim(coalesce(p_to, '')));
  v_test boolean := dpdp.is_test_mode();
  v_allow boolean;
  v_testrec boolean;
  v_reason text;
begin
  v_allow := exists (select 1 from dpdp.mail_allowlist a where a.email_lower = v_to);
  v_testrec := exists (select 1 from dpdp.identity_email ie join dpdp.test_identity ti on ti.identity_id = ie.identity_id where lower(ie.email) = v_to);
  v_reason := dpdp.mail_decision(v_test, v_allow, v_testrec);
  if v_reason like 'suppressed%' then
    insert into dpdp.mail_suppressed_log (source, reason, to_hash, to_domain)
    values (left(coalesce(nullif(btrim(p_source), ''), 'unknown'), 60), v_reason, encode(sha256(convert_to(v_to, 'UTF8')), 'hex'), nullif(split_part(v_to, '@', 2), ''));
  end if;
  return jsonb_build_object('send', v_reason in ('live', 'allowlisted'), 'reason', v_reason, 'mode', case when v_test then 'TEST' else 'LIVE' end);
end
$$;

create or replace function public.dpdp_owner_mail_allowlist(p_action text default 'list', p_email text default null, p_note text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, 'list')));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if v_action not in ('list', 'add', 'remove') then
    raise exception 'action must be list, add or remove' using errcode = '22023';
  end if;
  if v_action in ('add', 'remove') and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That e-mail address looks wrong' using errcode = '22023';
  end if;
  if v_action = 'add' then
    insert into dpdp.mail_allowlist (email_lower, note) values (v_email, nullif(left(btrim(coalesce(p_note, '')), 120), ''))
    on conflict (email_lower) do update set note = coalesce(excluded.note, dpdp.mail_allowlist.note);
    perform dpdp.platform_audit('mail_allowlist_added', jsonb_build_object('domain', split_part(v_email, '@', 2)));
  elsif v_action = 'remove' then
    if (select count(*) from dpdp.mail_allowlist) <= 1 and exists (select 1 from dpdp.mail_allowlist where email_lower = v_email) then
      raise exception 'Keep at least one address on the list, or Test mode could send to nobody' using errcode = '22023';
    end if;
    delete from dpdp.mail_allowlist where email_lower = v_email;
    perform dpdp.platform_audit('mail_allowlist_removed', jsonb_build_object('domain', split_part(v_email, '@', 2)));
  end if;
  return jsonb_build_object('ok', true, 'addresses', (select coalesce(jsonb_agg(jsonb_build_object('email', a.email_lower, 'note', a.note) order by a.email_lower), '[]'::jsonb) from dpdp.mail_allowlist a));
end
$$;

create or replace function public.dpdp_owner_suppressed_mail(p_limit integer default 50)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'source', x.source, 'reason', x.reason, 'domain', x.to_domain) order by x.at desc), '[]'::jsonb)
          from (select * from dpdp.mail_suppressed_log order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 500)) x);
end
$$;

-- ---------------------------------------------------------------------
-- 4. Payments: the commission and partner notice skip test payments (the one function, copied from 0734 with a single added condition)
-- ---------------------------------------------------------------------
create or replace function dpdp.account_on_payment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a dpdp.account;
  v_s dpdp.billing_setting;
  v_prev text;
  v_base timestamp;
  v_until timestamp;
  v_in_window boolean;
  v_amount integer;
  v_commission_id text;
begin
  select * into v_a from dpdp.account where org_id = new.org_id;
  if v_a.org_id is null then
    return new;
  end if;
  select * into v_s from dpdp.billing_setting where id = 1;
  v_prev := dpdp.billing_state_calc(dpdp.account_is_free(v_a), v_a.opened_at, v_a.paid_until, new.confirmed_at, v_s.trial_days, v_s.due_days, v_s.grace_days);
  v_base := greatest(coalesce(v_a.paid_until, v_a.opened_at + make_interval(days => v_s.trial_days)), new.confirmed_at);
  v_until := v_base + case new."interval" when 'year' then interval '12 months' else interval '1 month' end;

  update dpdp.account
  set paid_until = v_until,
      first_paid_at = coalesce(first_paid_at, new.confirmed_at),
      billing_interval = new."interval",
      locked_monthly_paise = case when v_prev = 'LOCKED' then coalesce(dpdp.plan_monthly_paise(v_a.plan_key, new.confirmed_at::date), locked_monthly_paise) else locked_monthly_paise end
  where org_id = new.org_id;

  -- The partner's commission: commission_percent of what was actually paid, for payments inside the first commission_months months
  -- after the first payment. Only for a PARTNER-attributed account (a ?ref= referral keeps the 0655/0674 rule; see the PR notes).
  if v_a.source_kind = 'partner' and v_a.attributed_identity_id is not null and new.amount_paise > 0 and not coalesce(new.is_test, false) then
    v_in_window := v_a.first_paid_at is null or new.confirmed_at < v_a.first_paid_at + make_interval(months => v_s.commission_months);
    if v_in_window then
      v_amount := round(new.amount_paise * v_s.commission_percent / 100.0)::integer;
      v_commission_id := replace(gen_random_uuid()::text, '-', '');
      insert into dpdp.account_commission (id, org_id, payment_id, partner_identity_id, rate_percent, base_paise, amount_paise)
      values (v_commission_id, new.org_id, new.id, v_a.attributed_identity_id, v_s.commission_percent, new.amount_paise, v_amount)
      on conflict (payment_id) do nothing;
      perform public.dpdp__partner_notify(v_a.attributed_identity_id, 'commission_earned', v_commission_id,
        jsonb_build_object('amountPaise', v_amount, 'basis', case new."interval" when 'year' then 'yearly' else 'monthly_first_year' end), true);
    end if;
  end if;
  return new;
end
$$;

-- The labelled Test payment: through the same confirmed-payment path as a real one (the payment trigger moves paid_until), never through Razorpay.
create or replace function public.dpdp_test_payment(p_interval text default 'month', p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_a dpdp.account;
  v_amount integer;
  v_booked jsonb;
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can record a test payment' using errcode = '42501';
  end if;
  if not dpdp.is_test_mode() then
    raise exception 'Test payments are only available while the platform is in Test mode' using errcode = '42501';
  end if;
  if p_interval is null or p_interval not in ('month', 'year') then
    raise exception 'interval must be ''month'' or ''year''' using errcode = '22023';
  end if;
  v_a := dpdp.account_for_org(v_m.org_id);
  if v_a.org_id is null then
    raise exception 'This organisation has no account' using errcode = '22023';
  end if;
  if not dpdp.org_is_test(v_a.org_id) then
    raise exception 'A test payment can only be recorded on a test account' using errcode = '22023';
  end if;
  v_amount := dpdp.charge_paise(v_a.locked_monthly_paise, p_interval);
  if v_amount is null or v_amount <= 0 then
    raise exception 'There is nothing to pay on this plan' using errcode = '22023';
  end if;
  perform set_config('dpdp.test_payment', 'on', true);
  v_booked := public.dpdp_record_confirmed_payment(v_a.org_id, v_a.account_type, p_interval, v_amount, current_date, 'Test payment (no money moved)');
  perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'test_payment_recorded', 'A test payment was recorded. No money moved.', p_interval);
  return v_booked || jsonb_build_object('test', true, 'paidUntil', (select to_char(a.paid_until, 'YYYY-MM-DD') from dpdp.account a where a.org_id = v_a.org_id));
end
$$;

-- ---------------------------------------------------------------------
-- 5. Purge: every test organisation and its data. Never an audit row (audit_*, dpdp.event), never the registry's own history.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_purge_test_data(p_confirm text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_orgs text[];
  v_ids text[];
  v_pass integer;
  v_progress boolean;
  v_n bigint;
  r record;
  v_total jsonb := '{}'::jsonb;
  v_skipped text[] := '{}';
  v_left_orgs integer;
  v_orgs_deleted bigint := 0;
  v_ids_deleted bigint := 0;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if coalesce(p_confirm, '') <> 'PURGE TEST DATA' then
    raise exception 'Type PURGE TEST DATA to confirm' using errcode = '22023';
  end if;
  select coalesce(array_agg(t.org_id), '{}') into v_orgs from dpdp.test_org t;
  select coalesce(array_agg(t.identity_id), '{}') into v_ids from dpdp.test_identity t;

  for v_pass in 1..12 loop
    v_progress := false;
    for r in
      select c.table_name::text as tbl, c.column_name::text as col
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'dpdp' and c.column_name in ('org_id', 'client_org_id', 'firm_org_id', 'referred_org_id')
        and c.table_name not like 'audit\_%' and c.table_name not in ('event', 'test_org', 'test_identity', 'mail_suppressed_log', 'organisation')
      order by c.table_name, c.column_name
    loop
      begin
        execute format('delete from dpdp.%I where %I = any($1)', r.tbl, r.col) using v_orgs;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_progress := true;
          v_total := v_total || jsonb_build_object(r.tbl, coalesce((v_total ->> r.tbl)::bigint, 0) + v_n);
        end if;
      exception
        when foreign_key_violation then null; -- a child is deleted first on a later pass
        when others then
          if not (r.tbl = any(v_skipped)) then v_skipped := v_skipped || r.tbl; end if;
      end;
    end loop;
    begin
      delete from dpdp.organisation where id = any(v_orgs);
      get diagnostics v_n = row_count;
      if v_n > 0 then v_progress := true; v_orgs_deleted := v_orgs_deleted + v_n; end if;
    exception when foreign_key_violation then null;
    end;
    exit when not v_progress;
  end loop;

  -- visits made in Test mode (their events go with them)
  delete from dpdp.visit_session where is_test;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_total := v_total || jsonb_build_object('visit_session', v_n); end if;

  -- identities that were created in Test mode and are still free of anything that must stay
  for r in select unnest(v_ids) as id loop
    begin
      delete from dpdp.visit_link where identity_id = r.id;
      delete from dpdp.referral where identity_id = r.id;
      delete from dpdp.identity_email where identity_id = r.id;
      delete from dpdp.identity where id = r.id;
      if found then v_ids_deleted := v_ids_deleted + 1; end if;
    exception when others then null;
    end;
  end loop;

  select count(*) into v_left_orgs from dpdp.organisation o where o.id = any(v_orgs);
  delete from dpdp.test_org t where not exists (select 1 from dpdp.organisation o where o.id = t.org_id);
  delete from dpdp.test_identity t where not exists (select 1 from dpdp.identity i where i.id = t.identity_id);
  perform dpdp.platform_audit('test_data_purged', jsonb_build_object('organisations', v_orgs_deleted, 'identities', v_ids_deleted, 'remainingOrganisations', v_left_orgs, 'tables', v_total));
  return jsonb_build_object('ok', true, 'organisationsDeleted', v_orgs_deleted, 'identitiesDeleted', v_ids_deleted, 'remainingOrganisations', v_left_orgs, 'rows', v_total, 'skippedTables', to_jsonb(v_skipped));
end
$$;

-- ---------------------------------------------------------------------
-- 6. Owner screens leave test data out by default
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_pending_claims()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when public.dpdp__is_platform_admin() then coalesce(jsonb_agg(jsonb_build_object(
    'orgId', o.id,
    'orgName', o.name,
    'product', o.product,
    'interval', s.self_declared_interval,
    'amountPaise', s.self_declared_amount_paise,
    'reference', s.self_declared_reference,
    'proofPath', s.self_declared_proof_path,
    'note', s.self_declared_note,
    'declaredAt', s.self_declared_at,
    'ownerEmail', ie.email
  ) order by s.self_declared_at asc), '[]'::jsonb)
  else (select null::jsonb where public.dpdp__require_platform_admin()) end
  from dpdp.subscription s
  join dpdp.organisation o on o.id = s.org_id
  left join dpdp.membership m on m.org_id = s.org_id and m.level = 'owner'
  left join dpdp.identity_email ie on ie.identity_id = m.identity_id and ie.is_primary
  where s.state = 'awaiting_confirmation' and not dpdp.org_is_test(s.org_id)
$$;

-- The visitor report and funnel: a mode filter, default 'live' (visits made in Test mode are left out). 'test' shows only those; 'all' shows both.
drop function if exists public.dpdp_visit_report(integer);
drop function if exists dpdp.visit_funnel(timestamptz, timestamptz, timestamptz);
create or replace function dpdp.visit_funnel(p_from timestamptz, p_to timestamptz, p_last_before timestamptz default null, p_mode text default 'live')
returns table (source_kind text, source_detail text, visits bigint, key_page bigint, cta bigint, signed_up bigint, org_created bigint, wizard_done bigint, paid bigint)
language sql stable
set search_path = ''
as $$
  with sf as (
    select s.*, coalesce(s.visitor_id, 'S' || s.id) as vk,
      exists (select 1 from dpdp.visit_event e where e.session_id = s.id and (e.kind in ('sec', 'choice') or (e.kind = 'pv' and e.path = any (array['/dpdp-firm/', '/dpdp-institution/', '/pricing/', '/partner/', '/about/', '/ai-assistant/'])))) as f_key,
      exists (select 1 from dpdp.visit_event e where e.session_id = s.id and e.kind = 'cta') as f_cta
    from dpdp.visit_session s where not s.is_bot and (p_mode = 'all' or (p_mode = 'test') = s.is_test)
  ),
  v as (
    select vk, min(started_at) as first_at, max(started_at) as last_at,
      (array_agg(source_kind order by started_at))[1] as source_kind,
      (array_agg(coalesce(utm_source, search_engine, referrer_host, '') order by started_at))[1] as source_detail,
      bool_or(f_key) as f_key, bool_or(f_cta) as f_cta
    from sf group by vk
  ),
  f as (
    select v.*,
      exists (select 1 from dpdp.visit_link l where l.visitor_id = v.vk) as f_signed,
      exists (select 1 from dpdp.visit_link l join dpdp.event ev on ev.actor_identity_id = l.identity_id
              where l.visitor_id = v.vk and ev.kind = 'organisation_created' and ev.occurred_at >= (v.first_at at time zone 'UTC')) as f_org,
      exists (select 1 from dpdp.visit_link l join dpdp.membership m on m.identity_id = l.identity_id
              where l.visitor_id = v.vk and m.first_visit_seen_at is not null and m.said_not_me_at is null and m.first_visit_seen_at >= (v.first_at at time zone 'UTC')) as f_wiz,
      exists (select 1 from dpdp.visit_link l join dpdp.membership m on m.identity_id = l.identity_id and m.level::text = 'owner' and m.state::text = 'active'
              join dpdp.event ev on ev.org_id = m.org_id
              where l.visitor_id = v.vk and ev.kind = 'payment_confirmed' and ev.occurred_at >= (v.first_at at time zone 'UTC')) as f_paid
    from v
    where v.first_at >= p_from and v.first_at < p_to and (p_last_before is null or v.last_at < p_last_before)
  ),
  r as (
    select source_kind, source_detail,
      f_paid as r_paid,
      (f_wiz or f_paid) as r_wiz,
      (f_org or f_wiz or f_paid) as r_org,
      (f_signed or f_org or f_wiz or f_paid) as r_signed,
      (f_cta or f_signed or f_org or f_wiz or f_paid) as r_cta,
      (f_key or f_cta or f_signed or f_org or f_wiz or f_paid) as r_key
    from f
  )
  select r.source_kind, r.source_detail, count(*)::bigint,
    count(*) filter (where r_key)::bigint, count(*) filter (where r_cta)::bigint, count(*) filter (where r_signed)::bigint,
    count(*) filter (where r_org)::bigint, count(*) filter (where r_wiz)::bigint, count(*) filter (where r_paid)::bigint
  from r group by r.source_kind, r.source_detail
$$;

create or replace function public.dpdp_visit_report(p_days integer default 30, p_mode text default 'live')
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := clock_timestamp() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_out jsonb;
begin
  if p_mode is null or p_mode not in ('live', 'test', 'all') then
    raise exception 'mode must be live, test or all' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'mode', p_mode,
    'days', v_days,
    'since', v_since,
    'totals', (select jsonb_build_object(
        'human_sessions', count(*) filter (where not is_bot),
        'human_visitors', count(distinct coalesce(visitor_id, 'S' || id)) filter (where not is_bot),
        'returning_visitors', (select count(*) from (select coalesce(visitor_id, 'S' || id) vk from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and started_at >= v_since group by 1 having count(*) > 1) q),
        'returning_sessions', count(*) filter (where not is_bot and visit_no > 1),
        'bot_sessions', count(*) filter (where is_bot))
      from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and started_at >= v_since),
    'count_only_visits', coalesce((select sum(n) from dpdp.visit_agg where dimension = 'off_pv' and human and day >= v_since::date), 0),
    'bots', coalesce((select jsonb_agg(x) from (select jsonb_build_object('bot', coalesce(bot_name, 'unknown'), 'sessions', count(*)) x from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and is_bot and started_at >= v_since group by bot_name order by count(*) desc limit 15) q), '[]'),
    'sources', coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind', source_kind, 'detail', coalesce(utm_source, search_engine, referrer_host, ''), 'sessions', count(*)) x from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and started_at >= v_since group by source_kind, coalesce(utm_source, search_engine, referrer_host, '') order by count(*) desc limit 25) q), '[]'),
    'campaigns', coalesce((select jsonb_agg(x) from (select jsonb_build_object('campaign', utm_campaign, 'medium', utm_medium, 'sessions', count(*)) x from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and utm_campaign is not null and started_at >= v_since group by utm_campaign, utm_medium order by count(*) desc limit 20) q), '[]'),
    'landing_pages', coalesce((select jsonb_agg(x) from (select jsonb_build_object('path', landing_path, 'sessions', count(*)) x from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and started_at >= v_since group by landing_path order by count(*) desc limit 20) q), '[]'),
    'devices', coalesce((select jsonb_agg(x) from (select jsonb_build_object('device', coalesce(device, '?'), 'sessions', count(*)) x from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and started_at >= v_since group by device order by count(*) desc) q), '[]'),
    'languages', coalesce((select jsonb_agg(x) from (select jsonb_build_object('language', coalesce(language, '?'), 'sessions', count(*)) x from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and started_at >= v_since group by language order by count(*) desc limit 10) q), '[]'),
    'places', coalesce((select jsonb_agg(x) from (select jsonb_build_object('country', coalesce(country, '?'), 'city', coalesce(city, ''), 'sessions', count(*)) x from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and started_at >= v_since group by country, city order by count(*) desc limit 25) q), '[]'),
    'sections', coalesce((select jsonb_agg(x) from (select jsonb_build_object('path', e.path, 'section', e.name, 'views', count(*), 'sessions', count(distinct e.session_id), 'avg_dwell_ms', round(avg(e.ms))::int) x
        from dpdp.visit_event e join dpdp.visit_session s on s.id = e.session_id where (p_mode = 'all' or (p_mode = 'test') = s.is_test) and e.kind = 'sec' and not s.is_bot and s.started_at >= v_since group by e.path, e.name order by count(*) desc limit 40) q), '[]'),
    'exits', coalesce((select jsonb_agg(x) from (select jsonb_build_object('path', exit_path, 'section', exit_section, 'sessions', count(*), 'avg_ms', round(avg(exit_ms))::int, 'avg_scroll', round(avg(exit_scroll))::int) x
        from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and exit_path is not null and started_at >= v_since group by exit_path, exit_section order by count(*) desc limit 30) q), '[]'),
    'ctas', coalesce((select jsonb_agg(x) from (select jsonb_build_object('cta', e.name, 'clicks', count(*), 'sessions', count(distinct e.session_id)) x
        from dpdp.visit_event e join dpdp.visit_session s on s.id = e.session_id where (p_mode = 'all' or (p_mode = 'test') = s.is_test) and e.kind = 'cta' and not s.is_bot and s.started_at >= v_since group by e.name order by count(*) desc limit 30) q), '[]'),
    'choices', coalesce((select jsonb_agg(x) from (select jsonb_build_object('choice', e.name, 'value', e.value, 'count', count(*)) x
        from dpdp.visit_event e join dpdp.visit_session s on s.id = e.session_id where (p_mode = 'all' or (p_mode = 'test') = s.is_test) and e.kind in ('choice', 'step') and not s.is_bot and s.started_at >= v_since group by e.name, e.value order by count(*) desc limit 40) q), '[]'),
    'funnel_by_source', coalesce((select jsonb_agg(to_jsonb(f) order by f.visits desc) from dpdp.visit_funnel(v_since, clock_timestamp() + interval '1 day', null, p_mode) f), '[]'),
    'returning_ip_hashes', coalesce((select jsonb_agg(x) from (select jsonb_build_object('ip_hash', left(ip_hash, 12), 'ip_short', max(ip_short), 'sessions', count(*), 'visitors', count(distinct coalesce(visitor_id, 'S' || id)), 'country', max(country)) x
        from dpdp.visit_session where (p_mode = 'all' or (p_mode = 'test') = is_test) and not is_bot and ip_hash is not null and started_at >= v_since group by ip_hash having count(*) > 1 order by count(*) desc limit 25) q), '[]')
  ) into v_out;
  return v_out;
end
$$;

create or replace function public.dpdp_billing_due_worklist(p_now timestamptz default now(), p_limit integer default 500, p_dry_run boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_now timestamp := coalesce(p_now, now()) at time zone 'UTC';
  v_week text := to_char(coalesce(p_now, now()) at time zone 'UTC', 'IYYY"-W"IW');
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_s dpdp.billing_setting;
  r record;
  v_out jsonb := '[]'::jsonb;
  v_raw text;
  v_n integer := 0;
begin
  select * into v_s from dpdp.billing_setting where id = 1;
  for r in
    with accts as (
      select a.*, dpdp.billing_state_calc(dpdp.account_is_free(a), a.opened_at, a.paid_until, v_now, v_s.trial_days, v_s.due_days, v_s.grace_days) as st,
             dpdp.account_period_end(a) as e
      from dpdp.account a where not a.is_test
    ),
    due as (select * from accts where st in ('DUE', 'GRACE', 'LOCKED')),
    contacts as (
      select d.org_id, lower(ie.email) as email, 'owner'::text as role
      from due d join dpdp.membership m on m.org_id = d.org_id and m.level = 'owner' and m.state = 'active'
      join dpdp.identity_email ie on ie.identity_id = m.identity_id and ie.is_primary
      left join dpdp.email_preference ep on ep.membership_id = m.id
      where ep.unsubscribed_at is null
      union all
      select d.org_id, lower(ie.email), 'head of department'
      from due d join dpdp.audit_org_policy p on p.org_id = d.org_id
      join lateral unnest(p.hod_identity_ids) as h(identity_id) on true
      join dpdp.identity_email ie on ie.identity_id = h.identity_id and ie.is_primary
      union all
      select d.org_id, lower(d.billing_contact_email), 'billing contact' from due d where d.billing_contact_email is not null
    ),
    picked as (
      select distinct on (c.org_id, c.email) c.org_id, c.email, c.role
      from contacts c order by c.org_id, c.email, case c.role when 'owner' then 0 when 'head of department' then 1 else 2 end
    )
    select d.org_id, o.name as org_name, d.st, d.e, d.final_download_sent_at, p.email, p.role
    from picked p join due d on d.org_id = p.org_id join dpdp.organisation o on o.id = p.org_id
    left join dpdp.billing_email_optout oo on oo.org_id = p.org_id and oo.email_lower = p.email
    left join dpdp.billing_notice_sent bs on bs.org_id = p.org_id and bs.email_lower = p.email and bs.week_key = v_week
    where oo.org_id is null
      and (bs.org_id is null or bs.status = 'failed' or (bs.status = 'claimed' and bs.created_at < (clock_timestamp() at time zone 'UTC') - interval '30 minutes'))
    order by d.e, p.org_id, p.email
    limit v_limit
  loop
    if coalesce(p_dry_run, false) then
      v_raw := 'bn_dryrun';  -- a dry run lists who WOULD be mailed and writes nothing
    else
      insert into dpdp.billing_notice_sent (org_id, email_lower, week_key, status) values (r.org_id, r.email, v_week, 'claimed')
      on conflict (org_id, email_lower, week_key) do update set status = 'claimed', created_at = (clock_timestamp() at time zone 'UTC');
      v_raw := 'bn_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      insert into dpdp.billing_notice_token (token_hash, org_id, email_lower) values (encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), r.org_id, r.email);
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'orgId', r.org_id, 'orgName', r.org_name, 'state', r.st, 'email', r.email, 'role', r.role, 'weekKey', v_week,
      'periodEndedOn', to_char(r.e, 'YYYY-MM-DD'), 'line', dpdp.billing_due_line(r.st), 'unsubscribeToken', v_raw,
      'finalDownload', r.final_download_sent_at is null and v_now >= r.e + make_interval(days => v_s.final_download_after_days)
    ));
    v_n := v_n + 1;
  end loop;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- 7. The offer end date: nulled for every plan, never shown, set only by the owner
-- ---------------------------------------------------------------------
update dpdp.plan set offer_ends_on = null, updated_at = (clock_timestamp() at time zone 'UTC') where offer_ends_on is not null;

create or replace function public.dpdp_owner_set_offer_end(p_ends_on date default null, p_plan_key text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if p_plan_key is not null and not exists (select 1 from dpdp.plan p where p.key = p_plan_key) then
    raise exception 'No such plan' using errcode = '22023';
  end if;
  if p_ends_on is not null and exists (select 1 from dpdp.plan p where (p_plan_key is null or p.key = p_plan_key) and p.offer_starts_on is not null and p.offer_starts_on > p_ends_on) then
    raise exception 'The end date is before the offer starts' using errcode = '22023';
  end if;
  update dpdp.plan set offer_ends_on = p_ends_on, updated_at = (clock_timestamp() at time zone 'UTC') where p_plan_key is null or key = p_plan_key;
  get diagnostics v_n = row_count;
  -- the date itself is stored only in dpdp.plan; the audit row says that it changed, never to what
  perform dpdp.platform_audit('offer_end_changed', jsonb_build_object('plans', v_n, 'cleared', p_ends_on is null));
  return jsonb_build_object('ok', true, 'plans', v_n);
end
$$;

-- ---------------------------------------------------------------------
-- 8. Self-declaration instead of verification
-- ---------------------------------------------------------------------
-- plan.requires_verified keeps its name (so 0734 stays re-runnable) and now means: needs the practitioner's self-declaration, not an owner check.
comment on column dpdp.plan.requires_verified is 'True when the plan needs the practitioner self-declaration (verification_status = declared). No owner verification exists any more.';
update dpdp.plan set name = 'Free (practising CA, CS or cost accountant)' where key = 'firm_free';

do $$
declare
  c record;
begin
  for c in select con.conname from pg_constraint con where con.conrelid = 'dpdp.account'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%verification_status%' loop
    execute format('alter table dpdp.account drop constraint %I', c.conname);
  end loop;
end
$$;
-- an owner-verified or pending firm is now simply a declared one; a rejected one is on a paid plan
update dpdp.account set verification_status = 'declared' where verification_status in ('pending', 'verified');
update dpdp.account set verification_status = 'downgraded' where verification_status = 'rejected';
alter table dpdp.account add constraint account_verification_status_ok check (verification_status in ('none', 'declared', 'downgraded'));
alter table dpdp.account add column if not exists declared_at timestamp;
alter table dpdp.account add column if not exists downgraded_at timestamp;
alter table dpdp.account add column if not exists registration_format_ok boolean;
update dpdp.account set declared_at = coalesce(verification_requested_at, opened_at) where verification_status = 'declared' and declared_at is null;

create table if not exists dpdp.account_profile (
  org_id text primary key references dpdp.organisation (id) on delete cascade,
  -- firm
  firm_name text, clients_estimate integer,
  -- institution
  legal_name text, institution_type text, size_band text, dpo_name text, dpo_email text,
  -- both
  city text, gstin text, contact_person text, phone text,
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint account_profile_institution_type check (institution_type is null or institution_type in ('company', 'school', 'NGO', 'other')),
  constraint account_profile_size_band check (size_band is null or size_band in ('1-10', '11-50', '51-200', '201-1000', '1000+')),
  constraint account_profile_clients check (clients_estimate is null or clients_estimate between 0 and 100000)
);
alter table dpdp.account_profile enable row level security;

-- Format only, per body, for information. The result is stored and shown to the platform owner; it never blocks anything.
create or replace function dpdp.registration_format_ok(p_body text, p_no text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_body is null or p_no is null or btrim(p_no) = '' then null
    when p_body = 'ICAI' then btrim(p_no) ~* '^([0-9]{5,7}|[0-9]{6}[NSEWC])$'
    when p_body = 'ICSI' then btrim(p_no) ~* '^((ACS|FCS|A|F) ?[0-9]{3,6}|[0-9]{4,6})$'
    when p_body = 'ICMAI' then btrim(p_no) ~* '^((ACMA|FCMA|A|F) ?[0-9]{3,6}|[0-9]{4,6}[A-Z]?)$'
    else null
  end
$$;

-- A free practitioner firm: declared, on a plan that asks for the declaration and costs nothing.
create or replace function dpdp.account_is_free(p_account dpdp.account)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_account.verification_status = 'declared'
     and exists (select 1 from dpdp.plan p where p.key = p_account.plan_key and p.requires_verified and p.list_monthly_paise = 0)
$$;

-- How much of the profile is filled. The fields counted are the ones the opening page asks for; none of them is required for anything.
create or replace function dpdp.profile_progress(p_org_id text, p_with_fields boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_a dpdp.account;
  v_p dpdp.account_profile;
  v_items jsonb;
  v_done integer;
  v_total integer;
begin
  select * into v_a from dpdp.account where org_id = p_org_id;
  if v_a.org_id is null then
    return null;
  end if;
  select * into v_p from dpdp.account_profile where org_id = p_org_id;
  if v_a.account_type = 'firm' then
    v_items := jsonb_build_array(
      jsonb_build_object('key', 'firmName', 'label', 'Firm name', 'done', v_p.firm_name is not null),
      jsonb_build_object('key', 'professionalBody', 'label', 'Professional body', 'done', v_a.professional_body is not null),
      jsonb_build_object('key', 'registrationNo', 'label', 'Membership or firm registration number', 'done', v_a.registration_no is not null),
      jsonb_build_object('key', 'city', 'label', 'City', 'done', v_p.city is not null),
      jsonb_build_object('key', 'gstin', 'label', 'GSTIN', 'done', v_p.gstin is not null),
      jsonb_build_object('key', 'clientsEstimate', 'label', 'About how many clients', 'done', v_p.clients_estimate is not null),
      jsonb_build_object('key', 'contactPerson', 'label', 'Contact person', 'done', v_p.contact_person is not null),
      jsonb_build_object('key', 'phone', 'label', 'Phone', 'done', v_p.phone is not null));
  else
    v_items := jsonb_build_array(
      jsonb_build_object('key', 'legalName', 'label', 'Legal name', 'done', v_p.legal_name is not null),
      jsonb_build_object('key', 'institutionType', 'label', 'Type of organisation', 'done', v_p.institution_type is not null),
      jsonb_build_object('key', 'sizeBand', 'label', 'Size', 'done', v_p.size_band is not null),
      jsonb_build_object('key', 'city', 'label', 'City', 'done', v_p.city is not null),
      jsonb_build_object('key', 'gstin', 'label', 'GSTIN', 'done', v_p.gstin is not null),
      jsonb_build_object('key', 'contactPerson', 'label', 'Contact person', 'done', v_p.contact_person is not null),
      jsonb_build_object('key', 'phone', 'label', 'Phone', 'done', v_p.phone is not null),
      jsonb_build_object('key', 'dpoName', 'label', 'DPO or Grievance Officer name', 'done', v_p.dpo_name is not null),
      jsonb_build_object('key', 'dpoEmail', 'label', 'DPO or Grievance Officer e-mail', 'done', v_p.dpo_email is not null));
  end if;
  select count(*) filter (where (i ->> 'done')::boolean), count(*) into v_done, v_total from jsonb_array_elements(v_items) i;
  return jsonb_build_object(
    'done', v_done, 'total', v_total, 'percent', round(100.0 * v_done / greatest(v_total, 1))::int,
    'missing', (select coalesce(jsonb_agg(jsonb_build_object('key', i ->> 'key', 'label', i ->> 'label')), '[]'::jsonb) from jsonb_array_elements(v_items) i where not (i ->> 'done')::boolean),
    'fields', case when p_with_fields then jsonb_strip_nulls(jsonb_build_object(
      'firmName', v_p.firm_name, 'clientsEstimate', v_p.clients_estimate, 'legalName', v_p.legal_name, 'institutionType', v_p.institution_type, 'sizeBand', v_p.size_band,
      'dpoName', v_p.dpo_name, 'dpoEmail', v_p.dpo_email, 'city', v_p.city, 'gstin', v_p.gstin, 'contactPerson', v_p.contact_person, 'phone', v_p.phone,
      'professionalBody', v_a.professional_body, 'registrationNo', v_a.registration_no)) end
  );
end
$$;

-- One text field from the profile JSON: trimmed, null when absent, empty, not text or longer than the limit.
create or replace function dpdp.profile_text(p jsonb, k text, p_max integer default 120)
returns text
language sql immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p -> k) = 'string' and char_length(btrim(p ->> k)) between 1 and p_max then btrim(p ->> k) end
$$;

-- Save the optional information. NEVER refuses for a value it does not like: that value is ignored and named in "ignored". The owner of the account only.
create or replace function public.dpdp_account_save_profile(p_profile jsonb, p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_a dpdp.account;
  v_prof dpdp.account_profile;
  v_p jsonb := case when jsonb_typeof(p_profile) = 'object' then p_profile else '{}'::jsonb end;
  v_ignored text[] := '{}';
  v_txt text;
  v_int integer;
  v_body text;
  v_reg text;
  v_decl boolean;
  v_used integer;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_note text;
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can fill in the account details' using errcode = '42501';
  end if;
  select * into v_a from dpdp.account where org_id = v_m.org_id;
  if v_a.org_id is null then
    raise exception 'This organisation has no account' using errcode = '22023';
  end if;
  select * into v_prof from dpdp.account_profile where org_id = v_m.org_id;
  v_prof.org_id := v_m.org_id;

  -- free text
  if v_p ? 'firmName' then v_prof.firm_name := dpdp.profile_text(v_p, 'firmName', 160); if v_prof.firm_name is null and nullif(btrim(coalesce(v_p ->> 'firmName', '')), '') is not null then v_ignored := array_append(v_ignored, 'firmName'::text); end if; end if;
  if v_p ? 'legalName' then v_prof.legal_name := dpdp.profile_text(v_p, 'legalName', 160); if v_prof.legal_name is null and nullif(btrim(coalesce(v_p ->> 'legalName', '')), '') is not null then v_ignored := array_append(v_ignored, 'legalName'::text); end if; end if;
  if v_p ? 'city' then v_prof.city := dpdp.profile_text(v_p, 'city', 80); if v_prof.city is null and nullif(btrim(coalesce(v_p ->> 'city', '')), '') is not null then v_ignored := array_append(v_ignored, 'city'::text); end if; end if;
  if v_p ? 'contactPerson' then v_prof.contact_person := dpdp.profile_text(v_p, 'contactPerson', 120); if v_prof.contact_person is null and nullif(btrim(coalesce(v_p ->> 'contactPerson', '')), '') is not null then v_ignored := array_append(v_ignored, 'contactPerson'::text); end if; end if;
  if v_p ? 'dpoName' then v_prof.dpo_name := dpdp.profile_text(v_p, 'dpoName', 120); if v_prof.dpo_name is null and nullif(btrim(coalesce(v_p ->> 'dpoName', '')), '') is not null then v_ignored := array_append(v_ignored, 'dpoName'::text); end if; end if;

  -- checked shapes: a value that does not fit is ignored, not refused
  if v_p ? 'phone' then
    v_txt := dpdp.profile_text(v_p, 'phone', 20);
    v_prof.phone := case when v_txt ~ '^[0-9 +()-]{6,20}$' then v_txt end;
    if v_prof.phone is null and v_txt is not null then v_ignored := array_append(v_ignored, 'phone'::text); end if;
    if v_txt is null and nullif(btrim(coalesce(v_p ->> 'phone', '')), '') is not null then v_ignored := array_append(v_ignored, 'phone'::text); end if;
  end if;
  if v_p ? 'gstin' then
    v_txt := upper(dpdp.profile_text(v_p, 'gstin', 15));
    v_prof.gstin := case when v_txt ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then v_txt end;
    if v_prof.gstin is null and nullif(btrim(coalesce(v_p ->> 'gstin', '')), '') is not null then v_ignored := array_append(v_ignored, 'gstin'::text); end if;
  end if;
  if v_p ? 'dpoEmail' then
    v_txt := lower(dpdp.profile_text(v_p, 'dpoEmail', 120));
    v_prof.dpo_email := case when v_txt ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_txt end;
    if v_prof.dpo_email is null and nullif(btrim(coalesce(v_p ->> 'dpoEmail', '')), '') is not null then v_ignored := array_append(v_ignored, 'dpoEmail'::text); end if;
  end if;
  if v_p ? 'clientsEstimate' then
    v_int := case when jsonb_typeof(v_p -> 'clientsEstimate') = 'number' and (v_p ->> 'clientsEstimate') ~ '^[0-9]{1,6}$' then (v_p ->> 'clientsEstimate')::integer
                  when jsonb_typeof(v_p -> 'clientsEstimate') = 'string' and btrim(v_p ->> 'clientsEstimate') ~ '^[0-9]{1,6}$' then btrim(v_p ->> 'clientsEstimate')::integer end;
    v_prof.clients_estimate := case when v_int between 0 and 100000 then v_int end;
    if v_prof.clients_estimate is null and nullif(btrim(coalesce(v_p ->> 'clientsEstimate', '')), '') is not null then v_ignored := array_append(v_ignored, 'clientsEstimate'::text); end if;
  end if;
  if v_p ? 'institutionType' then
    v_txt := lower(dpdp.profile_text(v_p, 'institutionType', 20));
    v_prof.institution_type := case v_txt when 'company' then 'company' when 'school' then 'school' when 'ngo' then 'NGO' when 'other' then 'other' end;
    if v_prof.institution_type is null and nullif(btrim(coalesce(v_p ->> 'institutionType', '')), '') is not null then v_ignored := array_append(v_ignored, 'institutionType'::text); end if;
  end if;
  if v_p ? 'sizeBand' then
    v_txt := dpdp.profile_text(v_p, 'sizeBand', 12);
    v_prof.size_band := case when v_txt in ('1-10', '11-50', '51-200', '201-1000', '1000+') then v_txt end;
    if v_prof.size_band is null and nullif(btrim(coalesce(v_p ->> 'sizeBand', '')), '') is not null then v_ignored := array_append(v_ignored, 'sizeBand'::text); end if;
  end if;
  v_prof.updated_at := v_now;

  -- the professional body and number (a firm only)
  v_body := v_a.professional_body;
  v_reg := v_a.registration_no;
  if v_p ? 'professionalBody' then
    v_txt := dpdp.profile_text(v_p, 'professionalBody', 10);
    v_body := case when v_txt in ('ICAI', 'ICSI', 'ICMAI', 'other') then v_txt end;
    if v_body is null and nullif(btrim(coalesce(v_p ->> 'professionalBody', '')), '') is not null then v_ignored := array_append(v_ignored, 'professionalBody'::text); end if;
  end if;
  if v_p ? 'registrationNo' then
    v_txt := dpdp.profile_text(v_p, 'registrationNo', 40);
    v_reg := case when char_length(v_txt) between 3 and 40 and v_txt ~ '^[A-Za-z0-9/ ._-]+$' then v_txt end;
    if v_reg is null and nullif(btrim(coalesce(v_p ->> 'registrationNo', '')), '') is not null then v_ignored := array_append(v_ignored, 'registrationNo'::text); end if;
  end if;
  if v_a.account_type <> 'firm' then
    if v_body is not null or v_reg is not null then v_ignored := array_append(v_ignored, 'professionalBody'::text); end if;
    v_body := null;
    v_reg := null;
  end if;

  insert into dpdp.account_profile (org_id, firm_name, clients_estimate, legal_name, institution_type, size_band, dpo_name, dpo_email, city, gstin, contact_person, phone, updated_at)
  values (v_prof.org_id, v_prof.firm_name, v_prof.clients_estimate, v_prof.legal_name, v_prof.institution_type, v_prof.size_band, v_prof.dpo_name, v_prof.dpo_email,
          v_prof.city, v_prof.gstin, v_prof.contact_person, v_prof.phone, v_prof.updated_at)
  on conflict (org_id) do update set firm_name = excluded.firm_name, clients_estimate = excluded.clients_estimate, legal_name = excluded.legal_name,
    institution_type = excluded.institution_type, size_band = excluded.size_band, dpo_name = excluded.dpo_name, dpo_email = excluded.dpo_email, city = excluded.city,
    gstin = excluded.gstin, contact_person = excluded.contact_person, phone = excluded.phone, updated_at = excluded.updated_at;

  update dpdp.account set professional_body = v_body, registration_no = v_reg, registration_format_ok = dpdp.registration_format_ok(v_body, v_reg) where org_id = v_a.org_id;

  -- "I am a practising CA / CS / cost accountant"
  if v_p ? 'practitionerDeclared' and jsonb_typeof(v_p -> 'practitionerDeclared') = 'boolean' then
    v_decl := (v_p ->> 'practitionerDeclared')::boolean;
    if v_a.account_type <> 'firm' then
      v_ignored := array_append(v_ignored, 'practitionerDeclared'::text);
    elsif v_decl and v_a.verification_status = 'downgraded' then
      v_note := 'This account is on a paid plan. Write to us if that is a mistake.';
      v_ignored := array_append(v_ignored, 'practitionerDeclared'::text);
    elsif v_decl and v_a.verification_status <> 'declared' then
      select count(*)::int into v_used from dpdp.account_client c where c.firm_org_id = v_a.org_id;
      update dpdp.account set verification_status = 'declared', declared_at = v_now where org_id = v_a.org_id;
      perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'firm_self_declared', 'The firm declared that it is a practising CA, CS or cost accountant', v_body);
      if v_used = 0 and v_a.plan_key = 'firm_starter' then
        update dpdp.account set plan_key = 'firm_free', locked_monthly_paise = 0 where org_id = v_a.org_id;
        perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'plan_chosen', 'Plan chosen: firm_free', 'declaration');
      elsif v_used > 0 then
        v_note := 'The free plan is for your own file, with no clients. You manage client organisations, so the plan stays as it is.';
      end if;
    elsif not v_decl and v_a.verification_status = 'declared' then
      update dpdp.account set verification_status = 'none', declared_at = null where org_id = v_a.org_id;
      perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'firm_declaration_withdrawn', 'The practitioner declaration was withdrawn', null);
      if v_a.plan_key = 'firm_free' then
        update dpdp.account set plan_key = 'firm_starter', locked_monthly_paise = dpdp.plan_monthly_paise('firm_starter', v_now::date) where org_id = v_a.org_id;
        perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'plan_chosen', 'Plan chosen: firm_starter', 'declaration withdrawn');
      end if;
    end if;
  end if;

  perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'account_profile_saved', 'Account details were updated', null);
  return jsonb_build_object('ok', true, 'ignored', to_jsonb(v_ignored), 'note', v_note,
    'status', (select a.verification_status from dpdp.account a where a.org_id = v_a.org_id),
    'planKey', (select a.plan_key from dpdp.account a where a.org_id = v_a.org_id),
    'profile', dpdp.profile_progress(v_a.org_id, true));
end
$$;

-- The old owner-verifies gate is gone.
drop function if exists public.dpdp_account_set_professional(text, text, text);
drop function if exists public.dpdp_owner_pending_verifications();
drop function if exists public.dpdp_owner_verify_firm(text, text, text);

-- The platform owner's view of the firms that declared, and the audited downgrade for abuse review.
create or replace function public.dpdp_owner_declared_firms(p_mode text default 'live')
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_mode text := lower(coalesce(nullif(btrim(p_mode), ''), 'live'));
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if v_mode not in ('live', 'test', 'all') then
    raise exception 'mode must be live, test or all' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'orgId', a.org_id, 'orgName', o.name, 'status', a.verification_status, 'planKey', a.plan_key,
      'professionalBody', a.professional_body, 'registrationNo', a.registration_no, 'formatOk', a.registration_format_ok,
      'firmName', pr.firm_name, 'city', pr.city, 'clientsEstimate', pr.clients_estimate,
      'declaredAt', a.declared_at, 'isTest', a.is_test
    ) order by a.declared_at desc nulls last), '[]'::jsonb)
    from dpdp.account a join dpdp.organisation o on o.id = a.org_id left join dpdp.account_profile pr on pr.org_id = a.org_id
    where a.account_type = 'firm' and a.verification_status in ('declared', 'downgraded')
      and (v_mode = 'all' or (v_mode = 'test') = a.is_test)
  );
end
$$;

create or replace function public.dpdp_owner_downgrade_firm(p_org_id text, p_note text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_a dpdp.account;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_a from dpdp.account where org_id = p_org_id;
  if v_a.org_id is null or v_a.account_type <> 'firm' then
    raise exception 'No such firm account' using errcode = '22023';
  end if;
  update dpdp.account
  set verification_status = 'downgraded', downgraded_at = (clock_timestamp() at time zone 'UTC'),
      plan_key = case when plan_key = 'firm_free' then 'firm_starter' else plan_key end,
      locked_monthly_paise = case when plan_key = 'firm_free' then dpdp.plan_monthly_paise('firm_starter', (clock_timestamp() at time zone 'UTC')::date) else locked_monthly_paise end
  where org_id = p_org_id;
  perform public.dpdp__append_event(p_org_id, null, 'Platform owner', 'firm_downgraded', 'The account was moved to a paid plan after a review', nullif(left(btrim(coalesce(p_note, '')), 200), ''));
  perform dpdp.platform_audit('firm_downgraded', jsonb_build_object('orgId', p_org_id));
  return jsonb_build_object('ok', true, 'status', 'downgraded', 'planKey', (select a.plan_key from dpdp.account a where a.org_id = p_org_id));
end
$$;

-- The plans for the chooser. No offer end date is ever returned.
create or replace function public.dpdp_public_plans()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', p.key, 'accountType', p.account_type, 'name', p.name, 'maxClients', p.max_clients, 'requiresDeclaration', p.requires_verified,
    'listMonthlyPaise', p.list_monthly_paise,
    'monthlyPaise', dpdp.plan_monthly_paise(p.key, (clock_timestamp() at time zone 'UTC')::date),
    'offerLabel', public.dpdp__offer_label(p.list_monthly_paise, dpdp.plan_monthly_paise(p.key, (clock_timestamp() at time zone 'UTC')::date)),
    'yearlyMonthsCharged', (select s.yearly_months_charged from dpdp.billing_setting s where s.id = 1)
  ) order by p.sort_order), '[]'::jsonb)
  from dpdp.plan p where p.active
$$;

create or replace function public.dpdp_open_account(
  p_account_type text, p_org_name text,
  p_professional_body text default null, p_registration_no text default null,
  p_referral_code text default null, p_partner_code text default null,
  p_source_tag text default null, p_first_seen_at timestamptz default null,
  p_billing_contact_email text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_s dpdp.billing_setting;
  v_body text := dpdp.clean_registration(p_professional_body);
  v_reg text := dpdp.clean_registration(p_registration_no);
  v_tag text := nullif(lower(btrim(coalesce(p_source_tag, ''))), '');
  v_in_window boolean;
  v_offer dpdp.partner_offer_code;
  v_kind text := 'none';
  v_attrib text;
  v_partner_code text;
  v_extra numeric := 0;
  v_ref_code text;
  v_res jsonb;
  v_org text;
  v_identity text;
  v_plan text;
  v_monthly integer;
  v_list integer;
  v_billing text := lower(nullif(btrim(coalesce(p_billing_contact_email, '')), ''));
begin
  if p_account_type is null or p_account_type not in ('firm', 'institution') then
    raise exception 'Choose whether this is a CA, CS or ICMAI firm, or a company or institution' using errcode = '22023';
  end if;
  -- Everything about the professional body is optional and NEVER blocks the sign-up: a value that does not fit is left out.
  if v_body is not null and v_body not in ('ICAI', 'ICSI', 'ICMAI', 'other') then
    v_body := null;
  end if;
  if v_reg is not null and (char_length(v_reg) not between 3 and 40 or v_reg !~ '^[A-Za-z0-9/ ._-]+$') then
    v_reg := null;
  end if;
  if p_account_type = 'institution' then
    v_body := null;
    v_reg := null;
  end if;
  if v_tag is not null and v_tag !~ '^[a-z0-9_.-]{1,60}$' then
    v_tag := null; -- a tag we do not understand is dropped, never a reason to refuse the sign-up
  end if;
  if v_billing is not null and v_billing !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'The billing contact e-mail looks wrong' using errcode = '22023';
  end if;
  select * into v_s from dpdp.billing_setting where id = 1;

  -- Attribution (first link wins on the visitor side; here: the window, then partner outranks referral).
  v_in_window := p_first_seen_at is null or p_first_seen_at >= (clock_timestamp() - make_interval(days => v_s.attribution_window_days));
  if v_in_window then
    if nullif(btrim(coalesce(p_partner_code, '')), '') is not null then
      select c.* into v_offer from dpdp.partner_offer_code c
       where c.code = upper(btrim(p_partner_code)) and c.active
         and exists (select 1 from dpdp.sales_partner sp where sp.identity_id = c.partner_identity_id and sp.status = 'active');
      if v_offer.code is not null then
        v_kind := 'partner';
        v_attrib := v_offer.partner_identity_id;
        v_partner_code := v_offer.code;
        v_extra := case when v_offer.extra_approved_at is not null then v_offer.extra_percent_off else 0 end;
      else
        -- ?sp= may also carry an active sales partner's own referral code
        select r.identity_id into v_attrib from dpdp.referral r
         where upper(r.code) = upper(btrim(p_partner_code)) and r.state = 'active'
           and exists (select 1 from dpdp.sales_partner sp where sp.identity_id = r.identity_id and sp.status = 'active');
        if v_attrib is not null then
          v_kind := 'partner';
        end if;
      end if;
    end if;
    if v_kind = 'none' and nullif(btrim(coalesce(p_referral_code, '')), '') is not null then
      select r.identity_id into v_attrib from dpdp.referral r where upper(r.code) = upper(btrim(p_referral_code)) and r.state = 'active';
      if v_attrib is not null then
        v_kind := 'referral';
        v_ref_code := btrim(p_referral_code);
      end if;
    end if;
    if v_kind = 'none' and v_tag is not null then
      v_kind := 'tracker';
    end if;
  else
    v_tag := null;
  end if;

  -- The organisation itself: the existing sign-up RPC (owner membership, jobs, 30-day subscription row, the referral event).
  v_res := public.dpdp_create_my_org(p_org_name, p_account_type, v_ref_code);
  v_org := v_res ->> 'orgId';
  v_identity := public.dpdp__caller_identity_id();
  if (v_res ->> 'existing')::boolean is true and exists (select 1 from dpdp.account a where a.org_id = v_org) then
    return v_res || jsonb_build_object('accountExisting', true);
  end if;
  if v_attrib is not null and v_attrib = v_identity then
    v_kind := case when v_tag is not null then 'tracker' else 'none' end; -- nobody earns on their own account
    v_attrib := null;
    v_partner_code := null;
    v_extra := 0;
  end if;

  v_plan := case p_account_type when 'institution' then 'institution' else 'firm_starter' end;
  v_monthly := dpdp.plan_monthly_paise(v_plan, v_now::date, v_extra);
  v_list := dpdp.plan_monthly_paise(v_plan, date '1900-01-01');
  insert into dpdp.account (
    org_id, account_type, plan_key, locked_monthly_paise, opened_at, billing_contact_email,
    professional_body, registration_no, verification_status,
    source_kind, source_tag, attributed_identity_id, partner_code, attributed_at
  ) values (
    v_org, p_account_type, v_plan, v_monthly, v_now, v_billing,
    v_body, v_reg, 'none',
    v_kind, v_tag, v_attrib, v_partner_code, case when v_kind in ('partner', 'referral') then v_now end
  ) on conflict (org_id) do nothing;

  perform public.dpdp__append_event(v_org, v_identity, 'Owner', 'account_opened', 'Account opened as a ' || p_account_type || ' account', v_plan);
  if v_kind = 'partner' then
    perform public.dpdp__partner_notify(v_attrib, 'referred_signup', v_org, jsonb_build_object('edition', p_account_type), true);
  end if;

  return v_res || jsonb_build_object(
    'accountType', p_account_type, 'planKey', v_plan, 'monthlyPaise', v_monthly, 'listMonthlyPaise', v_list,
    'offerActive', (v_monthly < v_list), 'attribution', v_kind, 'verification', 'none'
  );
end
$$;

create or replace function public.dpdp_my_account(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_a dpdp.account;
  v_p dpdp.plan;
  v_s dpdp.billing_setting;
  v_state text;
  v_e timestamp;
  v_used integer;
  v_owner boolean;
  v_covered boolean;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_list integer;
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  v_owner := v_m.level = 'owner';
  v_a := dpdp.account_for_org(v_m.org_id);
  if v_a.org_id is null then
    return jsonb_build_object('orgId', v_m.org_id, 'hasAccount', false, 'state', 'ACTIVE');
  end if;
  v_covered := v_a.org_id <> v_m.org_id;
  select * into v_s from dpdp.billing_setting where id = 1;
  select * into v_p from dpdp.plan where key = v_a.plan_key;
  v_state := dpdp.billing_state_calc(dpdp.account_is_free(v_a), v_a.opened_at, v_a.paid_until, v_now, v_s.trial_days, v_s.due_days, v_s.grace_days);
  v_e := dpdp.account_period_end(v_a);
  select count(*)::int into v_used from dpdp.account_client c where c.firm_org_id = v_a.org_id;
  v_list := v_p.list_monthly_paise;
  return jsonb_build_object(
    'orgId', v_m.org_id, 'hasAccount', true, 'coveredByFirm', v_covered,
    'accountType', v_a.account_type, 'planKey', v_a.plan_key, 'planName', v_p.name,
    'state', v_state, 'free', dpdp.account_is_free(v_a),
    'openedOn', to_char(v_a.opened_at, 'YYYY-MM-DD'),
    'periodEndsOn', to_char(v_e, 'YYYY-MM-DD'),
    'lockedOn', to_char(v_e + make_interval(days => v_s.due_days + v_s.grace_days), 'YYYY-MM-DD'),
    'finalDownloadOn', to_char(v_e + make_interval(days => v_s.final_download_after_days), 'YYYY-MM-DD'),
    'retentionEndsOn', to_char(v_e + make_interval(days => v_s.retention_days), 'YYYY-MM-DD'),
    'dueLine', dpdp.billing_due_line(v_state),
    'clients', jsonb_build_object('used', v_used, 'cap', v_p.max_clients),
    'verification', jsonb_build_object('status', v_a.verification_status, 'declared', v_a.verification_status = 'declared', 'body', v_a.professional_body,
      'registrationNo', case when v_owner and not v_covered then v_a.registration_no end),
    'profile', case when v_owner and not v_covered then dpdp.profile_progress(v_a.org_id, true) end,
    'isTest', v_a.is_test,
    'money', case when v_owner and not v_covered then jsonb_build_object(
      'interval', v_a.billing_interval,
      'monthlyPaise', v_a.locked_monthly_paise,
      'listMonthlyPaise', v_list,
      'offerLabel', public.dpdp__offer_label(v_list, v_a.locked_monthly_paise),
      'monthPaise', dpdp.charge_paise(v_a.locked_monthly_paise, 'month'),
      'yearPaise', dpdp.charge_paise(v_a.locked_monthly_paise, 'year'),
      'paidUntil', case when v_a.paid_until is null then null else to_char(v_a.paid_until, 'YYYY-MM-DD') end
    ) end
  );
end
$$;

create or replace function public.dpdp_account_choose_plan(p_plan_key text, p_interval text default 'month', p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_a dpdp.account;
  v_p dpdp.plan;
  v_used integer;
  v_monthly integer;
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can choose the plan' using errcode = '42501';
  end if;
  if p_interval is null or p_interval not in ('month', 'year') then
    raise exception 'interval must be ''month'' or ''year''' using errcode = '22023';
  end if;
  select * into v_a from dpdp.account where org_id = v_m.org_id;
  if v_a.org_id is null then
    raise exception 'This organisation has no account to change' using errcode = '22023';
  end if;
  select * into v_p from dpdp.plan where key = p_plan_key and active;
  if v_p.key is null or v_p.account_type <> v_a.account_type then
    raise exception 'That plan is not available for this kind of account' using errcode = '22023';
  end if;
  if v_p.requires_verified and v_a.verification_status <> 'declared' then
    raise exception 'The free plan is for practising CA, CS and cost accountants. Tick the declaration on your account page and it is yours.' using errcode = '22023';
  end if;
  select count(*)::int into v_used from dpdp.account_client c where c.firm_org_id = v_a.org_id;
  if v_used > v_p.max_clients then
    raise exception 'You manage % client organisations, and this plan covers up to %. Choose a bigger plan.', v_used, v_p.max_clients using errcode = '22023';
  end if;
  v_monthly := dpdp.plan_monthly_paise(v_p.key, (clock_timestamp() at time zone 'UTC')::date);
  update dpdp.account set plan_key = v_p.key, billing_interval = p_interval,
    locked_monthly_paise = case when v_p.key = v_a.plan_key then locked_monthly_paise else v_monthly end
  where org_id = v_a.org_id;
  perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'plan_chosen', 'Plan chosen: ' || v_p.key, p_interval);
  return jsonb_build_object('ok', true, 'planKey', v_p.key, 'monthlyPaise', case when v_p.key = v_a.plan_key then v_a.locked_monthly_paise else v_monthly end);
end
$$;

-- ---------------------------------------------------------------------
-- 9. Grants. The owner's mode switch is NOT executable by anon or service_role (so not by the AI link, which runs on service_role).
-- ---------------------------------------------------------------------
alter table dpdp.platform_mode enable row level security;
alter table dpdp.audit_platform_event enable row level security;
alter table dpdp.test_org enable row level security;
alter table dpdp.test_identity enable row level security;
alter table dpdp.mail_allowlist enable row level security;
alter table dpdp.mail_suppressed_log enable row level security;
revoke all on dpdp.platform_mode, dpdp.audit_platform_event, dpdp.test_org, dpdp.test_identity, dpdp.mail_allowlist, dpdp.mail_suppressed_log, dpdp.account_profile from public, anon, authenticated;

revoke all on function dpdp.audit_platform_event_guard() from public, anon, authenticated;
revoke all on function dpdp.platform_audit(text, jsonb) from public, anon, authenticated;
revoke all on function dpdp.platform_mode_audit() from public, anon, authenticated;
revoke all on function dpdp.is_test_mode() from public, anon, authenticated;
revoke all on function dpdp.org_is_test(text) from public, anon, authenticated;
revoke all on function dpdp.flag_test_org() from public, anon, authenticated;
revoke all on function dpdp.flag_test_identity() from public, anon, authenticated;
revoke all on function dpdp.flag_test_account() from public, anon, authenticated;
revoke all on function dpdp.flag_test_payment() from public, anon, authenticated;
revoke all on function dpdp.flag_test_referral_event() from public, anon, authenticated;
revoke all on function dpdp.skip_test_partner_notice() from public, anon, authenticated;
revoke all on function dpdp.flag_test_visit() from public, anon, authenticated;
revoke all on function dpdp.mail_decision(boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function dpdp.registration_format_ok(text, text) from public, anon, authenticated;
revoke all on function dpdp.profile_progress(text, boolean) from public, anon, authenticated;
revoke all on function dpdp.profile_text(jsonb, text, integer) from public, anon, authenticated;
revoke all on function dpdp.visit_funnel(timestamptz, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function dpdp.is_test_mode() to service_role, app_runtime;
grant execute on function dpdp.org_is_test(text) to service_role, app_runtime;
grant execute on function dpdp.mail_decision(boolean, boolean, boolean) to service_role, app_runtime;

revoke all on function public.dpdp_platform_mode() from public;
grant execute on function public.dpdp_platform_mode() to anon, authenticated, service_role, app_runtime;

revoke all on function public.dpdp_owner_set_mode(text, text) from public, anon, service_role;
grant execute on function public.dpdp_owner_set_mode(text, text) to authenticated, app_runtime;

revoke all on function public.dpdp_mail_gate(text, text) from public, anon, authenticated;
grant execute on function public.dpdp_mail_gate(text, text) to service_role, app_runtime;

revoke all on function public.dpdp_owner_mail_allowlist(text, text, text) from public, anon, service_role;
revoke all on function public.dpdp_owner_suppressed_mail(integer) from public, anon, service_role;
revoke all on function public.dpdp_owner_purge_test_data(text) from public, anon, service_role;
revoke all on function public.dpdp_owner_set_offer_end(date, text) from public, anon, service_role;
revoke all on function public.dpdp_owner_declared_firms(text) from public, anon;
revoke all on function public.dpdp_owner_downgrade_firm(text, text) from public, anon;
grant execute on function public.dpdp_owner_mail_allowlist(text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_suppressed_mail(integer) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_purge_test_data(text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_set_offer_end(date, text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_declared_firms(text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_downgrade_firm(text, text) to authenticated, app_runtime;

revoke all on function public.dpdp_test_payment(text, text) from public, anon;
revoke all on function public.dpdp_account_save_profile(jsonb, text) from public, anon;
grant execute on function public.dpdp_test_payment(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_account_save_profile(jsonb, text) to authenticated, app_runtime;

revoke all on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text) from public, anon;
revoke all on function public.dpdp_my_account(text) from public, anon;
revoke all on function public.dpdp_public_plans() from public;
revoke all on function public.dpdp_account_choose_plan(text, text, text) from public, anon;
grant execute on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text) to authenticated, app_runtime;
grant execute on function public.dpdp_my_account(text) to authenticated, app_runtime;
grant execute on function public.dpdp_public_plans() to anon, authenticated, service_role, app_runtime;
grant execute on function public.dpdp_account_choose_plan(text, text, text) to authenticated, app_runtime;

revoke all on function public.dpdp_owner_pending_claims() from public, anon;
grant execute on function public.dpdp_owner_pending_claims() to authenticated, app_runtime;

revoke all on function public.dpdp_visit_report(integer, text) from public, anon, authenticated;
grant execute on function public.dpdp_visit_report(integer, text) to service_role;
revoke all on function public.dpdp_billing_due_worklist(timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.dpdp_billing_due_worklist(timestamptz, integer, boolean) to service_role, app_runtime;
