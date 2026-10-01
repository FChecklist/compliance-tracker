-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-10-01 -- "COMPLETE THE FULL SALES PARTNER LIFECYCLE, AND SALES LIFECYCLE, INTEGRATE AND GO LIVE"
--
-- DPDP Sales Partner lifecycle (WO-DPDP-016 follow-on, 2026-10-01).
--
-- What exists before this file (drizzle/0611, 0655, 0658): every member has a
-- referral code; a referred organisation is recorded at sign-up
-- (dpdp.referral_event); when the Owner confirms a payment
-- (dpdp_record_confirmed_payment) a commission row is made in
-- dpdp.referral_commission (20% of every yearly payment, 5% of the first
-- confirmed monthly one); payout is manual (UPI or bank, outside this system).
--
-- What this file adds -- the parts a partner and the Owner were missing:
--   1. A partner profile with a lifecycle: applied -> active -> paused -> ended.
--      Anyone signed in can apply by accepting the partner terms (the version is
--      recorded) and giving payout details; the profile turns active when both
--      are done. No manual vetting step: the Owner decides nothing, and the
--      Owner can pause or end a partner at any time.
--   2. Payout details (UPI id, or bank account name / number / IFSC, and an
--      optional PAN). Strict RLS: the table has no policy and no grant, so it is
--      reachable only through the SECURITY DEFINER functions below. Every read a
--      partner can make is MASKED. Only the Owner's payout run reads the full
--      values, because the Owner has to send the money. No event, no log line
--      and no email ever carries them.
--   3. The payout cycle, as settings the Owner can change (dpdp.partner_setting),
--      with defaults chosen here and documented in dpdp-app/OPERATIONS.md:
--        * a commission becomes payable 30 days after the payment was confirmed
--          (the refund window);
--        * payouts run once a month, on the 10th, for everything that became
--          payable before the end of the previous month;
--        * minimum payout Rs 500 (on the net amount); smaller balances carry
--          forward to the next month;
--        * TDS: the ledger keeps gross, TDS and net per commission. The rate is a
--          settings row the Owner / the Owner's CA sets. It starts unset and a
--          payout cannot be marked paid until it has been set (0 is allowed), so a
--          statement is never wrong by default. Nothing in this file or in any
--          copy states a tax rate or gives tax advice.
--   4. Two rules on referrals: a partner cannot earn on an organisation they own
--      or belong to (checked at sign-up AND again when the payment is confirmed),
--      and a sign-up through the code of a partner whose status is not active
--      is recorded as blocked, not credited.
--   5. A small outbox of partner emails (welcome, "an organisation you referred
--      signed up", "commission earned", "payout sent", the monthly statement,
--      "your payout details were changed"). The Edge function dpdp-partner-email
--      sends them to the partner only; a notice carries counts and amounts, never
--      a client's name or any client personal data.
--   6. Two pg_cron jobs: the outbox flush every 30 minutes and the monthly
--      statement on the 11th.
--
-- Same rules as every dpdp browser-RPC file: public schema only, SECURITY
-- DEFINER, search_path = '', the caller is resolved from the JWT and never from
-- an argument, refusals are plain English, every write leaves an audit row
-- (dpdp.partner_event, and one dpdp.event in the person's newest organisation
-- when they have one; neither carries money details or payout details).
--
-- Existing callers are not broken: dpdp_record_confirmed_payment and
-- dpdp_mark_commission_paid keep their signatures and every key they returned
-- before; they only gain behaviour (the two rules above, the payable date, the
-- TDS snapshot). dpdp_create_my_org changes only by two enum casts (see the fix at the end of this file); the sign-up rules are a
-- trigger on dpdp.referral_event, so every path that records a referral is
-- covered, including the older Next.js one.

-- ---------------------------------------------------------------------
-- 1. Tables. RLS on, no policy, no grant: reachable only through the
--    functions below (same pattern as dpdp.ai_suggestion, drizzle/0671).
-- ---------------------------------------------------------------------

-- One row. Terms version lives here so a change of the agreement is one UPDATE
-- plus the new page, and the app can ask partners to accept the new version.
create table if not exists dpdp.partner_setting (
  id integer primary key default 1,
  payable_after_days integer not null default 30,
  payout_day integer not null default 10,
  min_payout_paise integer not null default 50000,
  tds_percent numeric(5, 2) not null default 0,
  tds_percent_set boolean not null default false,
  terms_version text not null default '1.0',
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  updated_by text,
  constraint partner_setting_single check (id = 1),
  constraint partner_setting_days check (payable_after_days between 0 and 365),
  constraint partner_setting_day check (payout_day between 1 and 28),
  constraint partner_setting_min check (min_payout_paise >= 0),
  constraint partner_setting_tds check (tds_percent >= 0 and tds_percent <= 100)
);
insert into dpdp.partner_setting (id) values (1) on conflict (id) do nothing;

create table if not exists dpdp.sales_partner (
  identity_id text primary key references dpdp.identity (id),
  status text not null default 'applied',
  display_name text,
  terms_version text,
  terms_accepted_at timestamp,
  applied_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  activated_at timestamp,
  status_changed_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  status_reason text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint sales_partner_status_check check (status in ('applied', 'active', 'paused', 'ended')),
  constraint sales_partner_name_len check (display_name is null or char_length(display_name) between 1 and 80)
);

-- Every acceptance, kept (a new version is a new row). Append-only.
create table if not exists dpdp.partner_terms_acceptance (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  identity_id text not null references dpdp.identity (id),
  version text not null,
  accepted_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  accepted_by_email text not null,
  constraint partner_terms_acceptance_once unique (identity_id, version)
);

create table if not exists dpdp.partner_payout_detail (
  identity_id text primary key references dpdp.sales_partner (identity_id),
  method text not null,
  upi_id text,
  account_name text,
  account_number text,
  ifsc text,
  pan text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint partner_payout_detail_method check (method in ('upi', 'bank')),
  constraint partner_payout_detail_shape check (
    (method = 'upi' and upi_id is not null and account_number is null and ifsc is null)
    or (method = 'bank' and account_name is not null and account_number is not null and ifsc is not null and upi_id is null)
  )
);

-- One row per payout the Owner made (UPI or bank, outside this system). The
-- reference is the UTR / transaction number. Append-only.
create table if not exists dpdp.partner_payout (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  referrer_identity_id text not null references dpdp.identity (id),
  period text not null,
  commissions integer not null check (commissions > 0),
  gross_paise integer not null check (gross_paise >= 0),
  tds_paise integer not null check (tds_paise >= 0),
  net_paise integer not null check (net_paise >= 0),
  method text not null,
  reference text not null,
  note text,
  paid_by text,
  paid_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint partner_payout_period check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint partner_payout_reference check (char_length(btrim(reference)) between 4 and 80),
  constraint partner_payout_once unique (referrer_identity_id, period, reference)
);
create index if not exists dpdp_partner_payout_referrer_idx on dpdp.partner_payout (referrer_identity_id, paid_at);

-- The commission ledger gains the payable date, the TDS columns and the payout
-- it was paid in. The TDS columns are filled when the commission is paid.
alter table dpdp.referral_commission
  add column if not exists payable_at timestamp,
  add column if not exists tds_rate numeric(5, 4),
  add column if not exists tds_paise integer,
  add column if not exists net_paise integer,
  add column if not exists payout_id text;
update dpdp.referral_commission set payable_at = created_at + interval '30 days' where payable_at is null;
update dpdp.referral_commission set tds_rate = 0, tds_paise = 0, net_paise = amount_paise
 where payout_status = 'paid' and net_paise is null;
alter table dpdp.referral_commission alter column payable_at set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'referral_commission_payout_fk') then
    -- Deferred: the payout row is written after the commissions it covers have been marked, in one transaction.
    alter table dpdp.referral_commission
      add constraint referral_commission_payout_fk foreign key (payout_id) references dpdp.partner_payout (id) deferrable initially deferred;
  end if;
end
$$;
create index if not exists dpdp_referral_commission_payable_idx on dpdp.referral_commission (payout_status, payable_at);

-- Partner emails waiting to go out. The dedupe key makes every notice happen once.
create table if not exists dpdp.partner_notice (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  identity_id text not null references dpdp.identity (id),
  kind text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  sent_at timestamp,
  skipped_at timestamp,
  attempts integer not null default 0,
  last_error text,
  constraint partner_notice_kind check (kind in ('welcome', 'referred_signup', 'commission_earned', 'payout_sent', 'statement', 'details_changed')),
  constraint partner_notice_once unique (identity_id, kind, dedupe_key)
);
create index if not exists dpdp_partner_notice_open_idx on dpdp.partner_notice (created_at) where sent_at is null and skipped_at is null;

-- The partner programme's own audit trail. Append-only. No payout detail ever goes in here.
create table if not exists dpdp.partner_event (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  identity_id text references dpdp.identity (id),
  kind text not null,
  summary text not null,
  detail text,
  at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create index if not exists dpdp_partner_event_identity_idx on dpdp.partner_event (identity_id, at);

alter table dpdp.partner_setting enable row level security;
alter table dpdp.sales_partner enable row level security;
alter table dpdp.partner_terms_acceptance enable row level security;
alter table dpdp.partner_payout_detail enable row level security;
alter table dpdp.partner_payout enable row level security;
alter table dpdp.partner_notice enable row level security;
alter table dpdp.partner_event enable row level security;
revoke all on dpdp.partner_setting, dpdp.sales_partner, dpdp.partner_terms_acceptance, dpdp.partner_payout_detail,
  dpdp.partner_payout, dpdp.partner_notice, dpdp.partner_event from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Triggers.
-- ---------------------------------------------------------------------

-- A record, not something to rewrite.
create or replace function dpdp.partner_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end
$$;
drop trigger if exists partner_terms_acceptance_guard on dpdp.partner_terms_acceptance;
create trigger partner_terms_acceptance_guard before update or delete on dpdp.partner_terms_acceptance
  for each row execute function dpdp.partner_append_only_guard();
drop trigger if exists partner_event_guard on dpdp.partner_event;
create trigger partner_event_guard before update or delete on dpdp.partner_event
  for each row execute function dpdp.partner_append_only_guard();
drop trigger if exists partner_payout_guard on dpdp.partner_payout;
create trigger partner_payout_guard before update or delete on dpdp.partner_payout
  for each row execute function dpdp.partner_append_only_guard();

-- A new commission becomes payable after the settings' number of days. Fixed at
-- creation, so changing the setting later does not move commissions already made.
create or replace function dpdp.referral_commission_set_payable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_days integer;
begin
  if new.payable_at is null then
    select s.payable_after_days into v_days from dpdp.partner_setting s where s.id = 1;
    new.payable_at := (clock_timestamp() at time zone 'UTC') + make_interval(days => coalesce(v_days, 30));
  end if;
  return new;
end
$$;
drop trigger if exists referral_commission_set_payable on dpdp.referral_commission;
create trigger referral_commission_set_payable before insert on dpdp.referral_commission
  for each row execute function dpdp.referral_commission_set_payable();

-- The two sign-up rules, for every path that records a referral:
--   * the referrer belongs to the new organisation  -> blocked, self_referral
--   * the referrer has a partner profile that is not active -> blocked, partner_not_active
-- A person who never opened a partner profile keeps working as before (the
-- older "every member has a share link" behaviour).
create or replace function dpdp.referral_event_partner_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.outcome::text = 'blocked' then
    return new;
  end if;
  if exists (
    select 1 from dpdp.membership m
    where m.org_id = new.referred_org_id and m.identity_id = new.referral_id and m.state = 'active'
  ) then
    new.outcome := 'blocked';
    new.block_reason := 'self_referral';
    return new;
  end if;
  select sp.status into v_status from dpdp.sales_partner sp where sp.identity_id = new.referral_id;
  if v_status is not null and v_status <> 'active' then
    new.outcome := 'blocked';
    new.block_reason := 'partner_not_active';
  end if;
  return new;
end
$$;
drop trigger if exists referral_event_partner_guard on dpdp.referral_event;
create trigger referral_event_partner_guard before insert on dpdp.referral_event
  for each row execute function dpdp.referral_event_partner_guard();

-- ---------------------------------------------------------------------
-- 3. Internal helpers. Not callable from a browser (revoked at the end).
-- ---------------------------------------------------------------------

-- One audit row, and one dpdp.event in the person's newest organisation when
-- they have one. Neither ever holds money details or payout details.
create or replace function public.dpdp__partner_event(p_identity text, p_kind text, p_summary text, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org text;
begin
  insert into dpdp.partner_event (identity_id, kind, summary, detail) values (p_identity, p_kind, p_summary, p_detail);
  if p_identity is not null then
    select m.org_id into v_org from dpdp.membership m
     where m.identity_id = p_identity and m.state = 'active'
     order by m.created_at desc limit 1;
    if v_org is not null then
      perform public.dpdp__append_event(v_org, p_identity, 'Sales Partner', p_kind, p_summary, p_detail);
    end if;
  end if;
end
$$;

-- Queues one email for a partner, once per dedupe key. By default only for an
-- active partner; the payout and statement notices also go to a paused or ended one.
create or replace function public.dpdp__partner_notify(p_identity text, p_kind text, p_dedupe text, p_payload jsonb, p_only_active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dpdp.sales_partner sp
     where sp.identity_id = p_identity and (not p_only_active or sp.status = 'active') and sp.status <> 'applied'
  ) then
    return;
  end if;
  insert into dpdp.partner_notice (identity_id, kind, dedupe_key, payload)
  values (p_identity, p_kind, p_dedupe, coalesce(p_payload, '{}'::jsonb))
  on conflict (identity_id, kind, dedupe_key) do nothing;
end
$$;

-- applied -> active, once the current terms are accepted AND payout details are saved.
create or replace function public.dpdp__partner_try_activate(p_identity text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set dpdp.partner_setting;
  v_p dpdp.sales_partner;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select * into v_set from dpdp.partner_setting where id = 1;
  select * into v_p from dpdp.sales_partner where identity_id = p_identity for update;
  if v_p.identity_id is null or v_p.status <> 'applied' then
    return false;
  end if;
  if v_p.terms_version is distinct from v_set.terms_version then
    return false;
  end if;
  if not exists (select 1 from dpdp.partner_payout_detail d where d.identity_id = p_identity) then
    return false;
  end if;
  update dpdp.sales_partner
     set status = 'active', activated_at = v_now, status_changed_at = v_now, status_reason = null, updated_at = v_now
   where identity_id = p_identity;
  perform public.dpdp__partner_event(p_identity, 'partner_activated', 'Became an active Sales Partner');
  perform public.dpdp__partner_notify(p_identity, 'welcome', 'welcome', '{}'::jsonb, true);
  return true;
end
$$;

-- "a client you referred signed up": counts only, never the client's name.
create or replace function dpdp.referral_event_partner_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition text;
begin
  if new.outcome::text = 'blocked' then
    return new;
  end if;
  select o.product into v_edition from dpdp.organisation o where o.id = new.referred_org_id;
  perform public.dpdp__partner_notify(new.referral_id, 'referred_signup', new.id, jsonb_build_object('edition', v_edition), true);
  return new;
end
$$;
drop trigger if exists referral_event_partner_notify on dpdp.referral_event;
create trigger referral_event_partner_notify after insert on dpdp.referral_event
  for each row execute function dpdp.referral_event_partner_notify();

-- ---------------------------------------------------------------------
-- 4. The partner's own screens (authenticated). Same shape as every dpdp_my_* RPC.
-- ---------------------------------------------------------------------

-- Accept the partner terms. Creates the person's identity if they have none yet
-- (a visitor who signed in but never opened an organisation can still be a partner).
create or replace function public.dpdp_partner_accept_terms(p_version text, p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_set dpdp.partner_setting;
  v_identity text;
  v_p dpdp.sales_partner;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_activated boolean;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_set from dpdp.partner_setting where id = 1;
  if p_version is distinct from v_set.terms_version then
    raise exception 'These are not the current partner terms (the current version is %). Reload the page and read them again.', v_set.terms_version using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'The name is too long (80 characters at most)' using errcode = '22023';
  end if;

  v_identity := public.dpdp__find_or_create_identity(v_email);
  select * into v_p from dpdp.sales_partner where identity_id = v_identity for update;
  if v_p.identity_id is not null and v_p.status = 'ended' then
    raise exception 'Your partnership has ended. Write to us if you want to join again.' using errcode = '42501';
  end if;

  if v_p.identity_id is null then
    insert into dpdp.sales_partner (identity_id, display_name, terms_version, terms_accepted_at)
    values (v_identity, v_name, p_version, v_now);
  else
    update dpdp.sales_partner
       set terms_version = p_version, terms_accepted_at = v_now, display_name = coalesce(v_name, display_name), updated_at = v_now
     where identity_id = v_identity;
  end if;
  insert into dpdp.partner_terms_acceptance (identity_id, version, accepted_by_email)
  values (v_identity, p_version, v_email)
  on conflict (identity_id, version) do nothing;

  perform public.dpdp__partner_event(v_identity, 'partner_terms_accepted', 'Accepted the Sales Partner terms, version ' || p_version, p_version);
  v_activated := public.dpdp__partner_try_activate(v_identity);
  return jsonb_build_object('ok', true, 'status', (select sp.status from dpdp.sales_partner sp where sp.identity_id = v_identity), 'activated', v_activated);
end
$$;

-- Save (or replace) the payout details. Needs the terms accepted first.
create or replace function public.dpdp_partner_save_payout_details(
  p_method text,
  p_upi_id text default null,
  p_account_name text default null,
  p_account_number text default null,
  p_ifsc text default null,
  p_pan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_identity text;
  v_p dpdp.sales_partner;
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_upi text := nullif(lower(btrim(coalesce(p_upi_id, ''))), '');
  v_name text := nullif(btrim(regexp_replace(coalesce(p_account_name, ''), '\s+', ' ', 'g')), '');
  v_acct text := nullif(regexp_replace(coalesce(p_account_number, ''), '[\s-]', '', 'g'), '');
  v_ifsc text := nullif(upper(btrim(coalesce(p_ifsc, ''))), '');
  v_pan text := nullif(upper(btrim(coalesce(p_pan, ''))), '');
  v_old dpdp.partner_payout_detail;
  v_changed boolean := false;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_activated boolean;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_identity := public.dpdp__caller_identity_id();
  select * into v_p from dpdp.sales_partner where identity_id = v_identity for update;
  if v_p.identity_id is null then
    raise exception 'Accept the partner terms first, then add your payout details.' using errcode = '42501';
  end if;
  if v_p.status = 'ended' then
    raise exception 'Your partnership has ended. Write to us if you want to join again.' using errcode = '42501';
  end if;
  if v_method not in ('upi', 'bank') then
    raise exception 'Choose how you want to be paid: UPI or bank transfer.' using errcode = '22023';
  end if;
  if v_name is not null and v_name !~ '^[A-Za-z][A-Za-z .''-]{1,79}$' then
    raise exception 'The name must use letters only, 2 to 80 characters.' using errcode = '22023';
  end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'That PAN does not look right. It has 5 letters, 4 digits and 1 letter. Leave it empty if you prefer.' using errcode = '22023';
  end if;

  if v_method = 'upi' then
    if v_upi is null or v_upi !~ '^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$' then
      raise exception 'That UPI id does not look right. It looks like name@bank.' using errcode = '22023';
    end if;
    v_acct := null;
    v_ifsc := null;
  else
    if v_name is null then
      raise exception 'Enter the name on the bank account.' using errcode = '22023';
    end if;
    if v_acct is null or v_acct !~ '^[0-9]{9,18}$' then
      raise exception 'The account number must be 9 to 18 digits.' using errcode = '22023';
    end if;
    if v_ifsc is null or v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'That IFSC code does not look right. It has 11 characters, for example HDFC0001234.' using errcode = '22023';
    end if;
    v_upi := null;
  end if;

  select * into v_old from dpdp.partner_payout_detail where identity_id = v_identity;
  if v_old.identity_id is not null then
    v_changed := (v_old.method, v_old.upi_id, v_old.account_number, v_old.ifsc) is distinct from (v_method, v_upi, v_acct, v_ifsc);
  end if;

  insert into dpdp.partner_payout_detail (identity_id, method, upi_id, account_name, account_number, ifsc, pan, created_at, updated_at)
  values (v_identity, v_method, v_upi, v_name, v_acct, v_ifsc, v_pan, v_now, v_now)
  on conflict (identity_id) do update
    set method = excluded.method, upi_id = excluded.upi_id, account_name = excluded.account_name,
        account_number = excluded.account_number, ifsc = excluded.ifsc, pan = excluded.pan, updated_at = v_now;

  -- The audit row names the method and nothing else.
  perform public.dpdp__partner_event(v_identity, 'partner_payout_details_saved', 'Saved payout details', v_method);
  if v_changed then
    perform public.dpdp__partner_notify(v_identity, 'details_changed', replace(gen_random_uuid()::text, '-', ''),
      jsonb_build_object('at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), false);
  end if;
  v_activated := public.dpdp__partner_try_activate(v_identity);
  return jsonb_build_object('ok', true, 'status', (select sp.status from dpdp.sales_partner sp where sp.identity_id = v_identity), 'activated', v_activated);
end
$$;

-- The partner's personal code. Only an active partner. It is the same code the
-- Share button hands out (dpdp.referral is keyed by the person).
create or replace function public.dpdp_partner_get_code()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_p dpdp.sales_partner;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try int := 0;
  v_i int;
begin
  v_identity := public.dpdp__caller_identity_id();
  select * into v_p from dpdp.sales_partner where identity_id = v_identity;
  if v_p.identity_id is null or v_p.status <> 'active' then
    raise exception 'Your personal link appears when your partner set-up is finished and active.' using errcode = '42501';
  end if;
  select r.code into v_code from dpdp.referral r where r.identity_id = v_identity;
  if v_code is not null then
    return jsonb_build_object('code', v_code);
  end if;
  loop
    v_try := v_try + 1;
    v_code := '';
    for v_i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from dpdp.referral r where r.code = v_code);
    if v_try >= 10 then
      raise exception 'Could not make a code, try again' using errcode = 'P0001';
    end if;
  end loop;
  insert into dpdp.referral (identity_id, code, consented_at, state)
  values (v_identity, v_code, (clock_timestamp() at time zone 'UTC'), 'active')
  on conflict (identity_id) do nothing;
  select r.code into v_code from dpdp.referral r where r.identity_id = v_identity;
  return jsonb_build_object('code', v_code);
end
$$;

-- The dashboard. Counts and money only: no client name, no client email, no
-- client personal data. Visits to the public site are not counted anywhere in
-- the database (the static pages run no counting script), so there is no
-- "visits" number here.
create or replace function public.dpdp_partner_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_identity text;
  v_set dpdp.partner_setting;
  v_p dpdp.sales_partner;
  v_d dpdp.partner_payout_detail;
  v_code text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_next date;
  v_funnel jsonb;
  v_money jsonb;
  v_lines jsonb;
  v_masked jsonb := null;
  v_rate numeric := null;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_set from dpdp.partner_setting where id = 1;
  v_identity := public.dpdp__caller_identity_id();
  select * into v_p from dpdp.sales_partner where identity_id = v_identity;

  v_next := make_date(extract(year from v_today)::int, extract(month from v_today)::int, v_set.payout_day);
  if v_next < v_today then
    v_next := (v_next + interval '1 month')::date;
  end if;
  if v_set.tds_percent_set then
    v_rate := v_set.tds_percent / 100.0;
  end if;

  if v_p.identity_id is null then
    return jsonb_build_object(
      'status', null, 'currentTermsVersion', v_set.terms_version, 'needsTerms', true, 'email', v_email,
      'payableAfterDays', v_set.payable_after_days, 'payoutDay', v_set.payout_day, 'minPayoutPaise', v_set.min_payout_paise,
      'nextPayoutOn', to_char(v_next, 'YYYY-MM-DD'), 'tdsPercentSet', v_set.tds_percent_set
    );
  end if;

  select r.code into v_code from dpdp.referral r where r.identity_id = v_identity;
  select * into v_d from dpdp.partner_payout_detail where identity_id = v_identity;
  if v_d.identity_id is not null then
    v_masked := jsonb_build_object(
      'method', v_d.method,
      'upiMasked', case when v_d.upi_id is null then null
                        else left(split_part(v_d.upi_id, '@', 1), 2) || '****@' || split_part(v_d.upi_id, '@', 2) end,
      'nameMasked', case when v_d.account_name is null then null
                         else (select string_agg(left(w.t, 1) || '***', ' ' order by w.n)
                                 from unnest(regexp_split_to_array(v_d.account_name, '\s+')) with ordinality as w(t, n)) end,
      'accountMasked', case when v_d.account_number is null then null
                            else repeat('X', greatest(length(v_d.account_number) - 4, 0)) || right(v_d.account_number, 4) end,
      'ifscMasked', case when v_d.ifsc is null then null else left(v_d.ifsc, 4) || '*******' end,
      'panMasked', case when v_d.pan is null then null else left(v_d.pan, 2) || '*******' || right(v_d.pan, 1) end,
      'updatedAt', v_d.updated_at
    );
  end if;

  select jsonb_build_object(
    'signedUp', count(*) filter (where re.outcome::text <> 'blocked'),
    'inTrial', count(*) filter (where re.outcome::text <> 'blocked' and coalesce(s.state, 'trial') in ('trial', 'awaiting_confirmation')),
    'paying', count(*) filter (where re.outcome::text <> 'blocked' and s.state = 'active'),
    'notCounted', count(*) filter (where re.outcome::text = 'blocked')
  ) into v_funnel
  from dpdp.referral_event re
  left join dpdp.subscription s on s.org_id = re.referred_org_id
  where re.referral_id = v_identity;

  select jsonb_build_object(
    'earnedPaise', coalesce(sum(c.amount_paise), 0),
    'waitingPaise', coalesce(sum(c.amount_paise) filter (where c.payout_status = 'pending' and c.payable_at > v_now), 0),
    'payablePaise', coalesce(sum(c.amount_paise) filter (where c.payout_status = 'pending' and c.payable_at <= v_now), 0),
    'paidGrossPaise', coalesce(sum(c.amount_paise) filter (where c.payout_status = 'paid'), 0),
    'paidTdsPaise', coalesce(sum(c.tds_paise) filter (where c.payout_status = 'paid'), 0),
    'paidNetPaise', coalesce(sum(c.net_paise) filter (where c.payout_status = 'paid'), 0)
  ) into v_money
  from dpdp.referral_commission c
  where c.referrer_identity_id = v_identity;

  select coalesce(jsonb_agg(jsonb_build_object(
    'at', l.created_at,
    'basis', l.basis,
    'ratePercent', (l.rate * 100)::numeric(5, 2),
    'grossPaise', l.amount_paise,
    'status', case when l.payout_status = 'paid' then 'paid' when l.payable_at <= v_now then 'payable' else 'waiting' end,
    'payableOn', to_char(l.payable_at, 'YYYY-MM-DD'),
    'paidOn', case when l.paid_at is null then null else to_char(l.paid_at, 'YYYY-MM-DD') end,
    'tdsPaise', case when l.payout_status = 'paid' then l.tds_paise
                     when v_rate is null then null else round(l.amount_paise * v_rate)::integer end,
    'netPaise', case when l.payout_status = 'paid' then l.net_paise
                     when v_rate is null then null else l.amount_paise - round(l.amount_paise * v_rate)::integer end,
    'tdsIsFinal', l.payout_status = 'paid'
  ) order by l.created_at desc), '[]'::jsonb) into v_lines
  from (
    select c.* from dpdp.referral_commission c
     where c.referrer_identity_id = v_identity
     order by c.created_at desc limit 100
  ) l;

  return jsonb_build_object(
    'status', v_p.status,
    'displayName', v_p.display_name,
    'email', v_email,
    'termsVersion', v_p.terms_version,
    'termsAcceptedAt', v_p.terms_accepted_at,
    'currentTermsVersion', v_set.terms_version,
    'needsTerms', v_p.terms_version is distinct from v_set.terms_version,
    'hasPayoutDetails', v_d.identity_id is not null,
    'payoutDetails', v_masked,
    'code', v_code,
    'funnel', v_funnel,
    'money', v_money,
    'lines', v_lines,
    'payableAfterDays', v_set.payable_after_days,
    'payoutDay', v_set.payout_day,
    'minPayoutPaise', v_set.min_payout_paise,
    'nextPayoutOn', to_char(v_next, 'YYYY-MM-DD'),
    'payableBefore', to_char(date_trunc('month', v_next::timestamp), 'YYYY-MM-DD'),
    'tdsPercentSet', v_set.tds_percent_set
  );
end
$$;

-- A month's statement: the commissions made in it and the commissions paid in
-- it, with gross, TDS and net. Same data the CSV download is made from.
create or replace function public.dpdp_partner_statement(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_identity text;
  v_period text := btrim(coalesce(p_period, ''));
  v_from timestamp;
  v_to timestamp;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_lines jsonb;
  v_payouts jsonb;
  v_tot jsonb;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose a month like 2026-09.' using errcode = '22023';
  end if;
  v_identity := public.dpdp__caller_identity_id();
  if v_identity is null or not exists (select 1 from dpdp.sales_partner sp where sp.identity_id = v_identity) then
    raise exception 'You are not a Sales Partner yet.' using errcode = '42501';
  end if;
  v_from := (v_period || '-01')::date;
  v_to := v_from + interval '1 month';

  select coalesce(jsonb_agg(jsonb_build_object(
    'madeOn', to_char(c.created_at, 'YYYY-MM-DD'),
    'basis', c.basis,
    'ratePercent', (c.rate * 100)::numeric(5, 2),
    'grossPaise', c.amount_paise,
    'tdsPaise', c.tds_paise,
    'netPaise', c.net_paise,
    'status', case when c.payout_status = 'paid' then 'paid' when c.payable_at <= v_now then 'payable' else 'waiting' end,
    'payableOn', to_char(c.payable_at, 'YYYY-MM-DD'),
    'paidOn', case when c.paid_at is null then null else to_char(c.paid_at, 'YYYY-MM-DD') end
  ) order by c.created_at), '[]'::jsonb) into v_lines
  from dpdp.referral_commission c
  where c.referrer_identity_id = v_identity
    and ((c.created_at >= v_from and c.created_at < v_to) or (c.paid_at >= v_from and c.paid_at < v_to));

  select coalesce(jsonb_agg(jsonb_build_object(
    'paidOn', to_char(p.paid_at, 'YYYY-MM-DD'),
    'period', p.period,
    'method', p.method,
    'reference', p.reference,
    'commissions', p.commissions,
    'grossPaise', p.gross_paise,
    'tdsPaise', p.tds_paise,
    'netPaise', p.net_paise
  ) order by p.paid_at), '[]'::jsonb) into v_payouts
  from dpdp.partner_payout p
  where p.referrer_identity_id = v_identity and p.paid_at >= v_from and p.paid_at < v_to;

  select jsonb_build_object(
    'madePaise', coalesce(sum(c.amount_paise) filter (where c.created_at >= v_from and c.created_at < v_to), 0),
    'paidGrossPaise', coalesce(sum(c.amount_paise) filter (where c.paid_at >= v_from and c.paid_at < v_to), 0),
    'paidTdsPaise', coalesce(sum(c.tds_paise) filter (where c.paid_at >= v_from and c.paid_at < v_to), 0),
    'paidNetPaise', coalesce(sum(c.net_paise) filter (where c.paid_at >= v_from and c.paid_at < v_to), 0),
    'stillWaitingPaise', coalesce(sum(c.amount_paise) filter (where c.payout_status = 'pending'), 0)
  ) into v_tot
  from dpdp.referral_commission c where c.referrer_identity_id = v_identity;

  return jsonb_build_object('period', v_period, 'email', v_email, 'lines', v_lines, 'payouts', v_payouts, 'totals', v_tot);
end
$$;

-- ---------------------------------------------------------------------
-- 5. The Owner's screens (authenticated, but every one refuses anyone who is not
--    on dpdp.platform_admin, exactly like dpdp_owner_pending_claims in 0658).
-- ---------------------------------------------------------------------

create or replace function public.dpdp_admin_partner_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set dpdp.partner_setting;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_set from dpdp.partner_setting where id = 1;
  return jsonb_build_object(
    'payableAfterDays', v_set.payable_after_days, 'payoutDay', v_set.payout_day, 'minPayoutPaise', v_set.min_payout_paise,
    'tdsPercent', v_set.tds_percent, 'tdsPercentSet', v_set.tds_percent_set, 'termsVersion', v_set.terms_version, 'updatedAt', v_set.updated_at
  );
end
$$;

-- Any argument left null is left as it was. Passing p_tds_percent (0 included) marks the TDS rate as set.
create or replace function public.dpdp_admin_partner_set_settings(
  p_payable_after_days integer default null,
  p_payout_day integer default null,
  p_min_payout_paise integer default null,
  p_tds_percent numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if p_payable_after_days is not null and (p_payable_after_days < 0 or p_payable_after_days > 365) then
    raise exception 'Days before a commission is payable must be 0 to 365.' using errcode = '22023';
  end if;
  if p_payout_day is not null and (p_payout_day < 1 or p_payout_day > 28) then
    raise exception 'The payout day must be 1 to 28.' using errcode = '22023';
  end if;
  if p_min_payout_paise is not null and p_min_payout_paise < 0 then
    raise exception 'The minimum payout cannot be negative.' using errcode = '22023';
  end if;
  if p_tds_percent is not null and (p_tds_percent < 0 or p_tds_percent > 100) then
    raise exception 'TDS percentage must be 0 to 100.' using errcode = '22023';
  end if;
  update dpdp.partner_setting set
    payable_after_days = coalesce(p_payable_after_days, payable_after_days),
    payout_day = coalesce(p_payout_day, payout_day),
    min_payout_paise = coalesce(p_min_payout_paise, min_payout_paise),
    tds_percent = coalesce(p_tds_percent, tds_percent),
    tds_percent_set = tds_percent_set or p_tds_percent is not null,
    updated_at = v_now, updated_by = v_email
  where id = 1;
  perform public.dpdp__partner_event(null, 'partner_settings_changed', 'Partner payout settings changed', null);
  return public.dpdp_admin_partner_settings();
end
$$;

-- Every partner, with counts and balances. Email is shown to the Owner only.
create or replace function public.dpdp_admin_partner_list()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t."appliedAt"), '[]'::jsonb) into v_out
  from (
    select sp.identity_id as "identityId", ie.email as "email", sp.display_name as "name", sp.status as "status",
           sp.terms_version as "termsVersion", sp.applied_at as "appliedAt", sp.activated_at as "activatedAt",
           exists (select 1 from dpdp.partner_payout_detail d where d.identity_id = sp.identity_id) as "hasPayoutDetails",
           (select count(*) from dpdp.referral_event re where re.referral_id = sp.identity_id and re.outcome::text <> 'blocked')::int as "signedUp",
           coalesce((select sum(c.amount_paise) from dpdp.referral_commission c where c.referrer_identity_id = sp.identity_id and c.payout_status = 'pending' and c.payable_at > v_now), 0)::int as "waitingPaise",
           coalesce((select sum(c.amount_paise) from dpdp.referral_commission c where c.referrer_identity_id = sp.identity_id and c.payout_status = 'pending' and c.payable_at <= v_now), 0)::int as "payablePaise",
           coalesce((select sum(c.net_paise) from dpdp.referral_commission c where c.referrer_identity_id = sp.identity_id and c.payout_status = 'paid'), 0)::int as "paidNetPaise"
      from dpdp.sales_partner sp
      left join dpdp.identity_email ie on ie.identity_id = sp.identity_id and ie.is_primary
  ) t;
  return v_out;
end
$$;

-- Pause / end / (re)activate a partner. Active needs the terms accepted and payout details saved.
create or replace function public.dpdp_admin_partner_set_status(p_identity_id text, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p dpdp.sales_partner;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if p_status not in ('active', 'paused', 'ended') then
    raise exception 'The status must be active, paused or ended.' using errcode = '22023';
  end if;
  select * into v_p from dpdp.sales_partner where identity_id = p_identity_id for update;
  if v_p.identity_id is null then
    raise exception 'No such partner' using errcode = '22023';
  end if;
  if p_status = 'active' and (v_p.terms_version is null or not exists (select 1 from dpdp.partner_payout_detail d where d.identity_id = p_identity_id)) then
    raise exception 'This partner has not finished set-up (terms and payout details), so they cannot be active yet.' using errcode = '22023';
  end if;
  update dpdp.sales_partner
     set status = p_status, status_changed_at = v_now, status_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         activated_at = case when p_status = 'active' and activated_at is null then v_now else activated_at end,
         updated_at = v_now
   where identity_id = p_identity_id;
  perform public.dpdp__partner_event(p_identity_id, 'partner_status_changed', 'Partner status is now ' || p_status, p_status);
  return jsonb_build_object('ok', true, 'status', p_status);
end
$$;

-- The monthly payout run. READS ONLY. p_period is the month whose end is the cut-off ("2026-09"
-- pays everything that became payable before 1 October); the default is the month before this one.
-- The unmasked payout details are returned here, to the Owner, because the Owner has to send the money.
create or replace function public.dpdp_admin_partner_payout_run(p_period text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set dpdp.partner_setting;
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_period text;
  v_cutoff timestamp;
  v_partners jsonb;
  v_held jsonb;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_set from dpdp.partner_setting where id = 1;
  v_period := coalesce(nullif(btrim(p_period), ''), to_char(date_trunc('month', v_today::timestamp) - interval '1 month', 'YYYY-MM'));
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose a month like 2026-09.' using errcode = '22023';
  end if;
  v_cutoff := ((v_period || '-01')::date + interval '1 month')::timestamp;
  if v_cutoff > v_today::timestamp then
    raise exception 'That month has not finished yet.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'identityId', per.identity_id, 'email', ie.email, 'name', sp.display_name, 'status', sp.status,
    'method', d.method, 'upiId', d.upi_id, 'accountName', d.account_name, 'accountNumber', d.account_number,
    'ifsc', d.ifsc, 'pan', d.pan,
    'detailsUpdatedAt', d.updated_at,
    'detailsChangedRecently', d.updated_at > ((clock_timestamp() at time zone 'UTC') - interval '7 days'),
    'commissions', per.n, 'grossPaise', per.gross, 'tdsPaise', per.tds, 'netPaise', per.gross - per.tds,
    'meetsMinimum', (per.gross - per.tds) >= v_set.min_payout_paise
  ) order by ie.email), '[]'::jsonb) into v_partners
  from (
    select c.referrer_identity_id as identity_id, count(*)::int as n, sum(c.amount_paise)::int as gross,
           sum(round(c.amount_paise * (v_set.tds_percent / 100.0)))::int as tds
      from dpdp.referral_commission c
     where c.payout_status = 'pending' and c.payable_at < v_cutoff
     group by c.referrer_identity_id
  ) per
  join dpdp.sales_partner sp on sp.identity_id = per.identity_id and sp.status in ('active', 'ended') and sp.terms_version is not null
  join dpdp.partner_payout_detail d on d.identity_id = per.identity_id
  left join dpdp.identity_email ie on ie.identity_id = per.identity_id and ie.is_primary;

  select coalesce(jsonb_agg(jsonb_build_object(
    'identityId', h.identity_id, 'email', ie.email, 'grossPaise', h.gross,
    'reason', case
      when sp.identity_id is null then 'not a partner yet (has not accepted the terms)'
      when sp.status = 'paused' then 'partner is paused'
      when sp.terms_version is null then 'terms not accepted'
      when d.identity_id is null then 'no payout details saved'
      else 'partner set-up is not finished'
    end
  ) order by ie.email), '[]'::jsonb) into v_held
  from (
    select c.referrer_identity_id as identity_id, sum(c.amount_paise)::int as gross
      from dpdp.referral_commission c
     where c.payout_status = 'pending' and c.payable_at < v_cutoff
     group by c.referrer_identity_id
  ) h
  left join dpdp.sales_partner sp on sp.identity_id = h.identity_id
  left join dpdp.partner_payout_detail d on d.identity_id = h.identity_id
  left join dpdp.identity_email ie on ie.identity_id = h.identity_id and ie.is_primary
  where sp.identity_id is null or sp.status not in ('active', 'ended') or sp.terms_version is null or d.identity_id is null;

  return jsonb_build_object(
    'period', v_period, 'payableBefore', to_char(v_cutoff, 'YYYY-MM-DD'),
    'tdsPercentSet', v_set.tds_percent_set, 'tdsPercent', v_set.tds_percent,
    'minPayoutPaise', v_set.min_payout_paise, 'payoutDay', v_set.payout_day,
    'partners', v_partners, 'held', v_held
  );
end
$$;

-- Marks one partner's payout for a month as paid, once the Owner has sent the
-- money and has the UTR / reference. The lines are worked out here again, not
-- taken from the browser. Same reference twice returns the first payout (a retry never pays twice).
create or replace function public.dpdp_admin_partner_mark_paid(p_period text, p_identity_id text, p_reference text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set dpdp.partner_setting;
  v_admin text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_period text := btrim(coalesce(p_period, ''));
  v_ref text := btrim(coalesce(p_reference, ''));
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_cutoff timestamp;
  v_existing dpdp.partner_payout;
  v_method text;
  v_rate numeric(5, 4);
  v_pid text := replace(gen_random_uuid()::text, '-', '');
  v_n integer;
  v_gross integer;
  v_tds integer;
  v_net integer;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_to text;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_set from dpdp.partner_setting where id = 1;
  if not v_set.tds_percent_set then
    raise exception 'Set the TDS percentage first (enter 0 if no TDS applies), so every statement is right.' using errcode = '22023';
  end if;
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose a month like 2026-09.' using errcode = '22023';
  end if;
  if char_length(v_ref) < 4 or char_length(v_ref) > 80 then
    raise exception 'Enter the UTR or transaction reference of the payment (4 to 80 characters).' using errcode = '22023';
  end if;
  v_cutoff := ((v_period || '-01')::date + interval '1 month')::timestamp;
  if v_cutoff > v_today::timestamp then
    raise exception 'That month has not finished yet.' using errcode = '22023';
  end if;

  select * into v_existing from dpdp.partner_payout
   where referrer_identity_id = p_identity_id and period = v_period and reference = v_ref;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'alreadyPaid', true, 'payoutId', v_existing.id, 'netPaise', v_existing.net_paise);
  end if;

  select d.method into v_method
    from dpdp.sales_partner sp join dpdp.partner_payout_detail d on d.identity_id = sp.identity_id
   where sp.identity_id = p_identity_id and sp.status in ('active', 'ended') and sp.terms_version is not null
   for update of sp;
  if v_method is null then
    raise exception 'This partner cannot be paid yet (paused, terms not accepted, or no payout details).' using errcode = '22023';
  end if;

  v_rate := round(v_set.tds_percent / 100.0, 4);
  with upd as (
    update dpdp.referral_commission c
       set payout_status = 'paid', paid_at = v_now, paid_note = left('Payout ' || v_period || ', ref ' || v_ref || coalesce(', ' || nullif(btrim(p_note), ''), ''), 400),
           tds_rate = v_rate,
           tds_paise = round(c.amount_paise * v_rate)::integer,
           net_paise = c.amount_paise - round(c.amount_paise * v_rate)::integer,
           payout_id = v_pid
     where c.referrer_identity_id = p_identity_id and c.payout_status = 'pending' and c.payable_at < v_cutoff
    returning c.amount_paise, c.tds_paise, c.net_paise
  )
  select count(*)::integer, coalesce(sum(amount_paise), 0)::integer, coalesce(sum(tds_paise), 0)::integer, coalesce(sum(net_paise), 0)::integer
    into v_n, v_gross, v_tds, v_net from upd;
  if v_n = 0 then
    raise exception 'Nothing is payable to this partner for that month.' using errcode = '22023';
  end if;
  if v_net < v_set.min_payout_paise then
    raise exception 'The net amount is below the minimum payout of Rs %. It carries forward to the next month.', to_char(v_set.min_payout_paise / 100.0, 'FM999999990') using errcode = '22023';
  end if;

  insert into dpdp.partner_payout (id, referrer_identity_id, period, commissions, gross_paise, tds_paise, net_paise, method, reference, note, paid_by, paid_at)
  values (v_pid, p_identity_id, v_period, v_n, v_gross, v_tds, v_net, v_method, v_ref, nullif(btrim(coalesce(p_note, '')), ''), v_admin, v_now);

  perform public.dpdp__partner_event(p_identity_id, 'partner_payout_paid', 'Commission payout for ' || v_period || ' marked as paid', v_period);
  perform public.dpdp__partner_notify(p_identity_id, 'payout_sent', v_pid,
    jsonb_build_object('period', v_period, 'grossPaise', v_gross, 'tdsPaise', v_tds, 'netPaise', v_net, 'method', v_method, 'reference', v_ref, 'commissions', v_n), false);
  select ie.email into v_to from dpdp.identity_email ie where ie.identity_id = p_identity_id and ie.is_primary;
  return jsonb_build_object('ok', true, 'alreadyPaid', false, 'payoutId', v_pid, 'email', v_to,
    'commissions', v_n, 'grossPaise', v_gross, 'tdsPaise', v_tds, 'netPaise', v_net);
end
$$;

-- ---------------------------------------------------------------------
-- 6. For the mail function and the monthly job (service_role only).
-- ---------------------------------------------------------------------

create or replace function public.dpdp_partner_notices_pending(p_limit integer default 50)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'to', ie.email, 'name', sp.display_name, 'payload', n.payload) order by n.created_at), '[]'::jsonb)
  from (
    select x.* from dpdp.partner_notice x
     where x.sent_at is null and x.skipped_at is null and x.attempts < 5
     order by x.created_at limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) n
  join dpdp.identity_email ie on ie.identity_id = n.identity_id and ie.is_primary
  left join dpdp.sales_partner sp on sp.identity_id = n.identity_id
$$;

create or replace function public.dpdp_partner_notice_mark(p_id text, p_status text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'status must be sent, failed or skipped' using errcode = '22023';
  end if;
  update dpdp.partner_notice set
    sent_at = case when p_status = 'sent' then (clock_timestamp() at time zone 'UTC') else sent_at end,
    skipped_at = case when p_status = 'skipped' then (clock_timestamp() at time zone 'UTC') else skipped_at end,
    attempts = case when p_status = 'failed' then attempts + 1 else attempts end,
    last_error = case when p_status = 'failed' then left(coalesce(p_error, 'failed'), 300) else last_error end
  where id = p_id;
  return jsonb_build_object('ok', found);
end
$$;

-- Queues the monthly statement (the month before this one by default) for every
-- partner who made, was paid or still holds a commission. Once per partner per month.
create or replace function public.dpdp_partner_enqueue_statements(p_period text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set dpdp.partner_setting;
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_period text;
  v_from timestamp;
  v_to timestamp;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_next date;
  v_n integer;
begin
  select * into v_set from dpdp.partner_setting where id = 1;
  v_period := coalesce(nullif(btrim(p_period), ''), to_char(date_trunc('month', v_today::timestamp) - interval '1 month', 'YYYY-MM'));
  if v_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose a month like 2026-09.' using errcode = '22023';
  end if;
  v_from := (v_period || '-01')::date;
  v_to := v_from + interval '1 month';
  v_next := make_date(extract(year from v_today)::int, extract(month from v_today)::int, v_set.payout_day);
  if v_next < v_today then
    v_next := (v_next + interval '1 month')::date;
  end if;

  insert into dpdp.partner_notice (identity_id, kind, dedupe_key, payload)
  select sp.identity_id, 'statement', v_period,
         jsonb_build_object(
           'period', v_period,
           'madePaise', a.made, 'paidGrossPaise', a.paid_gross, 'paidTdsPaise', a.paid_tds, 'paidNetPaise', a.paid_net,
           'waitingPaise', a.waiting, 'payablePaise', a.payable,
           'nextPayoutOn', to_char(v_next, 'YYYY-MM-DD'), 'minPayoutPaise', v_set.min_payout_paise)
    from dpdp.sales_partner sp
   cross join lateral (
     select coalesce(sum(c.amount_paise) filter (where c.created_at >= v_from and c.created_at < v_to), 0)::int as made,
            coalesce(sum(c.amount_paise) filter (where c.paid_at >= v_from and c.paid_at < v_to), 0)::int as paid_gross,
            coalesce(sum(c.tds_paise) filter (where c.paid_at >= v_from and c.paid_at < v_to), 0)::int as paid_tds,
            coalesce(sum(c.net_paise) filter (where c.paid_at >= v_from and c.paid_at < v_to), 0)::int as paid_net,
            coalesce(sum(c.amount_paise) filter (where c.payout_status = 'pending' and c.payable_at > v_now), 0)::int as waiting,
            coalesce(sum(c.amount_paise) filter (where c.payout_status = 'pending' and c.payable_at <= v_now), 0)::int as payable
       from dpdp.referral_commission c where c.referrer_identity_id = sp.identity_id
   ) a
   where sp.status <> 'applied' and (a.made + a.paid_gross + a.waiting + a.payable) > 0
  on conflict (identity_id, kind, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'period', v_period, 'queued', v_n);
end
$$;

-- ---------------------------------------------------------------------
-- 7. The two existing money functions, extended (same signatures, same keys).
-- ---------------------------------------------------------------------

-- dpdp_record_confirmed_payment (0655 section 4), plus: no commission when the
-- referrer belongs to the paying organisation, none when the referrer's partner
-- profile is paused or ended, and a "commission earned" notice to an active partner.
-- The payable date comes from the commission trigger above.
create or replace function public.dpdp_record_confirmed_payment(
  p_org_id text, p_plan text, p_interval text, p_amount_paise integer, p_period_start date default current_date, p_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payment_id text;
  v_event dpdp.referral_event;
  v_rate numeric(5, 4);
  v_basis text;
  v_commission_amount integer;
  v_commission_id text;
  v_referrer_org_id text;
  v_skip text;
  v_partner_status text;
begin
  if not exists (select 1 from dpdp.organisation o where o.id = p_org_id) then
    raise exception 'No such organisation' using errcode = '22023';
  end if;
  if p_plan not in ('firm', 'institution') then
    raise exception 'plan must be ''firm'' or ''institution''' using errcode = '22023';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'interval must be ''month'' or ''year''' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be a positive number' using errcode = '22023';
  end if;

  v_payment_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, period_start, confirmed_note)
  values (v_payment_id, p_org_id, p_plan, p_interval, p_amount_paise, coalesce(p_period_start, current_date), p_note);

  perform public.dpdp__append_event(p_org_id, null, 'System', 'payment_confirmed',
    'Payment confirmed: Rs ' || to_char(p_amount_paise / 100.0, 'FM999999999.00') || ' (' || p_plan || ', ' || p_interval || 'ly)', p_interval);

  insert into dpdp.subscription (org_id, trial_ends_at, state, "interval", last_confirmed_at)
  values (p_org_id, (clock_timestamp() at time zone 'UTC'), 'active', p_interval, (clock_timestamp() at time zone 'UTC'))
  on conflict (org_id) do update set state = 'active', "interval" = p_interval, last_confirmed_at = (clock_timestamp() at time zone 'UTC');

  select re.* into v_event
  from dpdp.referral_event re
  where re.referred_org_id = p_org_id and re.outcome in ('signed_up', 'chose_band')
  order by re.at asc
  limit 1;

  if v_event.id is not null then
    -- A partner never earns on an organisation they own or belong to, even if they joined it after the sign-up.
    if exists (
      select 1 from dpdp.membership m
      where m.org_id = p_org_id and m.identity_id = v_event.referral_id and m.state = 'active'
    ) then
      v_skip := 'self_referral';
    else
      select sp.status into v_partner_status from dpdp.sales_partner sp where sp.identity_id = v_event.referral_id;
      if v_partner_status in ('paused', 'ended') then
        v_skip := 'partner_not_active';
      end if;
    end if;

    if v_skip is not null then
      perform public.dpdp__partner_event(v_event.referral_id, 'commission_skipped', 'No commission on one confirmed payment (' || v_skip || ')', v_skip);
    else
      if p_interval = 'year' then
        v_rate := 0.20;
        v_basis := 'yearly';
      elsif not exists (select 1 from dpdp.payment p2 where p2.org_id = p_org_id and p2.id <> v_payment_id) then
        v_rate := 0.05;
        v_basis := 'first_month';
      end if;

      if v_rate is not null then
        v_commission_amount := round(p_amount_paise * v_rate)::integer;
        v_commission_id := replace(gen_random_uuid()::text, '-', '');
        insert into dpdp.referral_commission (id, referral_event_id, payment_id, referrer_identity_id, rate, amount_paise, basis)
        values (v_commission_id, v_event.id, v_payment_id, v_event.referral_id, v_rate, v_commission_amount, v_basis);

        update dpdp.referral_event set outcome = 'chose_band' where id = v_event.id and outcome = 'signed_up';

        select m.org_id into v_referrer_org_id
        from dpdp.membership m
        where m.identity_id = v_event.referral_id and m.level = 'owner' and m.state = 'active'
        order by m.created_at asc limit 1;
        if v_referrer_org_id is not null then
          perform public.dpdp__append_event(v_referrer_org_id, v_event.referral_id, 'System', 'referral_commission_earned',
            'Referral commission earned: Rs ' || to_char(v_commission_amount / 100.0, 'FM999999999.00') || ' (' || v_basis || ')', v_basis);
        end if;
        perform public.dpdp__partner_notify(v_event.referral_id, 'commission_earned', v_commission_id,
          jsonb_build_object('amountPaise', v_commission_amount, 'basis', v_basis), true);
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'paymentId', v_payment_id, 'commissionId', v_commission_id, 'commissionAmountPaise', v_commission_amount, 'commissionSkipped', v_skip);
end
$$;

-- dpdp_mark_commission_paid (0655 section 6): unchanged behaviour, and the gross / TDS / net
-- columns are now filled too (at the TDS rate in the settings, 0 if never set). The monthly payout
-- run (dpdp_admin_partner_mark_paid) is the way to pay; this stays for a one-off by hand.
create or replace function public.dpdp_mark_commission_paid(p_commission_id text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rate numeric(5, 4);
begin
  select round(s.tds_percent / 100.0, 4) into v_rate from dpdp.partner_setting s where s.id = 1;
  v_rate := coalesce(v_rate, 0);
  update dpdp.referral_commission c
  set payout_status = 'paid', paid_at = (clock_timestamp() at time zone 'UTC'), paid_note = p_note,
      tds_rate = v_rate, tds_paise = round(c.amount_paise * v_rate)::integer, net_paise = c.amount_paise - round(c.amount_paise * v_rate)::integer
  where c.id = p_commission_id and c.payout_status = 'pending';
  if not found then
    if exists (select 1 from dpdp.referral_commission where id = p_commission_id) then
      return jsonb_build_object('ok', true, 'alreadyPaid', true);
    end if;
    raise exception 'No such commission' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'alreadyPaid', false);
end
$$;

-- ---------------------------------------------------------------------
-- 8. Grants. Helpers: nobody (the definer functions above run as the owner).
--    Partner and Owner screens: signed-in browser (the Owner ones refuse anyone
--    not on dpdp.platform_admin). Mail and cron helpers: service_role only.
--    app_runtime is granted wherever authenticated is, only so a database-gated
--    test can call them with a simulated JWT, like every file before this one.
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__partner_event(text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp__partner_notify(text, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.dpdp__partner_try_activate(text) from public, anon, authenticated;

revoke all on function public.dpdp_partner_accept_terms(text, text) from public, anon;
revoke all on function public.dpdp_partner_save_payout_details(text, text, text, text, text, text) from public, anon;
revoke all on function public.dpdp_partner_get_code() from public, anon;
revoke all on function public.dpdp_partner_dashboard() from public, anon;
revoke all on function public.dpdp_partner_statement(text) from public, anon;
grant execute on function public.dpdp_partner_accept_terms(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_partner_save_payout_details(text, text, text, text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_partner_get_code() to authenticated, app_runtime;
grant execute on function public.dpdp_partner_dashboard() to authenticated, app_runtime;
grant execute on function public.dpdp_partner_statement(text) to authenticated, app_runtime;

revoke all on function public.dpdp_admin_partner_settings() from public, anon;
revoke all on function public.dpdp_admin_partner_set_settings(integer, integer, integer, numeric) from public, anon;
revoke all on function public.dpdp_admin_partner_list() from public, anon;
revoke all on function public.dpdp_admin_partner_set_status(text, text, text) from public, anon;
revoke all on function public.dpdp_admin_partner_payout_run(text) from public, anon;
revoke all on function public.dpdp_admin_partner_mark_paid(text, text, text, text) from public, anon;
grant execute on function public.dpdp_admin_partner_settings() to authenticated, app_runtime;
grant execute on function public.dpdp_admin_partner_set_settings(integer, integer, integer, numeric) to authenticated, app_runtime;
grant execute on function public.dpdp_admin_partner_list() to authenticated, app_runtime;
grant execute on function public.dpdp_admin_partner_set_status(text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_admin_partner_payout_run(text) to authenticated, app_runtime;
grant execute on function public.dpdp_admin_partner_mark_paid(text, text, text, text) to authenticated, app_runtime;

revoke all on function public.dpdp_partner_notices_pending(integer) from public, anon, authenticated;
revoke all on function public.dpdp_partner_notice_mark(text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_partner_enqueue_statements(text) from public, anon, authenticated;
grant execute on function public.dpdp_partner_notices_pending(integer) to service_role, app_runtime;
grant execute on function public.dpdp_partner_notice_mark(text, text, text) to service_role, app_runtime;
grant execute on function public.dpdp_partner_enqueue_statements(text) to service_role, app_runtime;

-- Re-state the grants of the two replaced functions (CREATE OR REPLACE keeps them; this is for the reader).
revoke all on function public.dpdp_record_confirmed_payment(text, text, text, integer, date, text) from public, anon, authenticated;
grant execute on function public.dpdp_record_confirmed_payment(text, text, text, integer, date, text) to service_role, app_runtime;
revoke all on function public.dpdp_mark_commission_paid(text, text) from public, anon, authenticated;
grant execute on function public.dpdp_mark_commission_paid(text, text) to service_role, app_runtime;

-- ---------------------------------------------------------------------
-- 9. Schedules (same pattern, same Vault secrets as dpdp-operator-digest, drizzle/0667).
--    * every 30 minutes: send whatever partner emails are waiting;
--    * the 11th of each month, 03:30 UTC (09:00 IST): queue and send last month's statements.
--    Only created where pg_cron and pg_net exist. A run with nothing waiting sends nothing.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-partner-mail',
      '*/30 * * * *',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-partner-email'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"flush"}'::jsonb,
          timeout_milliseconds := 60000
        )
      $cron$
    );
    perform cron.schedule(
      'dpdp-partner-statements',
      '30 3 11 * *',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-partner-email'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"statements"}'::jsonb,
          timeout_milliseconds := 60000
        )
      $cron$
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- FIX (found by the rolled-back live rehearsal, 2026-10-01): dpdp_create_my_org (0655)
-- inserts `case when .. then signed_up else blocked end` into referral_event.outcome.
-- Those literals resolve to text, which Postgres will not assign to the enum, so EVERY sign-up
-- that arrives with a referral code raised 42804. The only change below is the two ::dpdp.referral_outcome casts;
-- the body is otherwise the live definition, byte for byte. Grants are kept by create or replace.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_create_my_org(p_name text, p_product text, p_referral_code text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_name text := trim(coalesce(p_name, ''));
  v_identity text;
  v_base text;
  v_slug text;
  v_n int := 1;
  v_org_id text;
  v_membership_id text;
  v_jobs int;
  v_existing record;
  v_ref dpdp.referral;
  v_block_reason text;
  v_event_id text;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'An organisation name is required' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'The organisation name is too long (120 characters at most)' using errcode = '22023';
  end if;
  if p_product is null or p_product not in ('firm', 'institution') then
    raise exception 'product must be ''firm'' or ''institution''' using errcode = '22023';
  end if;

  v_identity := public.dpdp__find_or_create_identity(v_email);

  -- A double click, a refresh or a retry returns the organisation just made.
  select o.id, o.slug, m.id as membership_id into v_existing
  from dpdp.membership m join dpdp.organisation o on o.id = m.org_id
  where m.identity_id = v_identity and m.level = 'owner' and m.joined_via = 'created'
    and o.name = v_name and o.product = p_product and o.created_at > (clock_timestamp() at time zone 'UTC') - interval '10 minutes'
  order by o.created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'orgId', v_existing.id, 'slug', v_existing.slug, 'membershipId', v_existing.membership_id, 'jobs', 0, 'existing', true);
  end if;

  if (select count(*) from dpdp.membership m join dpdp.organisation o on o.id = m.org_id
      where m.identity_id = v_identity and m.level = 'owner' and m.joined_via = 'created'
        and o.created_at > (clock_timestamp() at time zone 'UTC') - interval '1 day') >= 5 then
    raise exception 'That is enough new organisations for one day. Try again tomorrow.' using errcode = '22023';
  end if;

  v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then
    v_base := 'org';
  end if;
  v_slug := v_base;
  while exists (select 1 from dpdp.organisation o where o.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  v_org_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.organisation (id, name, slug, product) values (v_org_id, v_name, v_slug, p_product);

  v_membership_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via)
  values (v_membership_id, v_identity, v_org_id, 'owner', 'created');
  -- can_sign is never set at join time (membership_no_sign_at_join): a deliberate, separate update.
  update dpdp.membership set can_sign = true where id = v_membership_id;

  perform public.dpdp__append_event(v_org_id, v_identity, v_email, 'organisation_created', 'Organisation "' || v_name || '" created');
  v_jobs := public.dpdp__instantiate_obligations(v_org_id, v_identity);

  -- §7: 30 free days from registration, not from any calendar boundary.
  insert into dpdp.subscription (org_id, trial_ends_at, state)
  values (v_org_id, (clock_timestamp() at time zone 'UTC') + interval '30 days', 'trial')
  on conflict (org_id) do nothing;

  -- Referral attribution (WO-016), ported from src/lib/services/dpdp-
  -- referral-service.ts's decideReferralConflict/recordReferralAttempt so
  -- the static app never has to call back into the Next.js path:
  --   self_referral  -- the code belongs to the very person who just
  --                     signed up (their own new org is, trivially, one of
  --                     their own active orgs).
  --   shared_advisor -- one of the referrer's own orgs already 'advises'
  --                     this brand-new org, which cannot happen for an org
  --                     that is seconds old -- kept anyway so the two paths
  --                     (this one and the legacy Next.js route) can never
  --                     disagree if that ever changes.
  -- A code that does not resolve to an active dpdp.referral row is ignored
  -- (typo, revoked code, or simply none given): silently, the org is still
  -- created, exactly as the legacy path's best-effort recordReferralAttempt
  -- swallows a bad code rather than failing the signup over it.
  if p_referral_code is not null and trim(p_referral_code) <> '' then
    select r.* into v_ref from dpdp.referral r where upper(r.code) = upper(trim(p_referral_code)) and r.state = 'active';
    if v_ref.identity_id is not null then
      if v_ref.identity_id = v_identity then
        v_block_reason := 'self_referral';
      elsif exists (
        select 1 from dpdp.relationship rel
        join dpdp.membership rm on rm.org_id = rel.from_org and rm.identity_id = v_ref.identity_id and rm.state = 'active'
        where rel.to_org = v_org_id and rel.kind = 'advises' and rel.ended_at is null
      ) then
        v_block_reason := 'shared_advisor';
      else
        v_block_reason := null;
      end if;
      v_event_id := replace(gen_random_uuid()::text, '-', '');
      insert into dpdp.referral_event (id, referral_id, referred_org_id, at, outcome, block_reason)
      values (v_event_id, v_ref.identity_id, v_org_id, (clock_timestamp() at time zone 'UTC'),
        case when v_block_reason is null then 'signed_up'::dpdp.referral_outcome else 'blocked'::dpdp.referral_outcome end, v_block_reason);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'orgId', v_org_id, 'slug', v_slug, 'membershipId', v_membership_id, 'jobs', v_jobs, 'existing', false);
end
$function$;
