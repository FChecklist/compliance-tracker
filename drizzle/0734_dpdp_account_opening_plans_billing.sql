-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved the DPDP account/plan model in chat on 2026-10-06 ("currently yes, build it")
--
-- DPDP "open an account": two account types, a plans table, firm verification, and a billing state machine.
-- NOT applied live by the session that wrote it; the PM applies it after CI is green.
--
-- NUMBERING: 0730 (PR 2110), 0731 (merged), 0732 (merged), 0733 (PR 2116) are taken, so this is 0734.
--
-- OWNER DECISION THIS FILE IMPLEMENTS (reverses the 0655 "access never locks" rule, in chat, 2026-10-06):
--   TRIAL (30 days from the account opening, everything works)
--     -> DUE (from day 31: everything still works, e-mails carry a calm "payment is due" line)
--     -> GRACE (7 more days, still works)
--     -> LOCKED (working screens and the AI work link refuse with a plain "payment is due" message).
--   A LOCKED account still reaches: the payment screen, "Download my data", and the legal-duty actions
--   (record a personal data breach, answer a grievance, honour a consent withdrawal). E-mails to the account's own
--   contacts continue forever, each with a one-click unsubscribe link.
--   The state is COMPUTED from dates and payment records every time it is asked; it is never stored.
--   Orgs that have NO dpdp.account row (every organisation that existed before this migration, and client organisations that
--   a firm manages) are never locked on their own: an old organisation stays as it was, a client organisation follows its firm.
--
-- WHAT IT ADDS
--   dpdp.billing_setting   one row: trial/due/grace days, yearly = 10 months, commission rule, attribution window (all editable).
--   dpdp.plan              the plans, with a LIST price and an OFFER price (per month, rupees in paise, ex GST) and an offer date window.
--   dpdp.account           one row per account (an organisation that opened itself): type, plan, price it signed up at, paid-until,
--                          firm verification, source attribution.
--   dpdp.account_client    the client organisations a firm manages (the cap counts these).
--   dpdp.partner_offer_code a sales partner's code: applies the active offer and tags the sale to the partner.
--   dpdp.account_commission the partner commission ledger (50% of the first 12 months of payments, on the price actually paid).
--   dpdp.billing_* tables  the e-mail opt-out, the one-click tokens and the weekly "already sent" book for billing notices.
--   public.dpdp_open_account / dpdp_my_account / dpdp_account_choose_plan / dpdp_account_set_professional / dpdp_public_plans
--   public.dpdp_owner_verify_firm / dpdp_owner_pending_verifications / dpdp_owner_mark_paid / dpdp_owner_update_plan / dpdp_owner_set_partner_code
--   public.dpdp_locked_download / dpdp_locked_record_breach / dpdp_locked_answer_grievance   (the always-open actions)
--   public.dpdp_create_client_org   now enforces the plan's client cap and records the firm -> client link.
--   public.dpdp_billing_due_worklist / dpdp_billing_notice_mark / dpdp_billing_final_download_mark / dpdp_timer_billing_due_line
--   gate: dpdp__caller_membership refuses a locked account's working screens; dpdp__ai_link_for_token refuses the AI work link.
--
-- Every write appends a dpdp.event (which the 0731 audit trail copies). No event carries an e-mail address, a name or a money-sensitive detail.
-- Razorpay: not live. dpdp_owner_mark_paid books money through dpdp_record_confirmed_payment (0655) and the AFTER INSERT trigger on
-- dpdp.payment extends paid_until, so a Razorpay webhook (dpdp_pay_confirm -> dpdp_record_confirmed_payment) moves the same state with no new code.

-- ---------------------------------------------------------------------
-- 1. Settings and plans (editable; seeded)
-- ---------------------------------------------------------------------
create table if not exists dpdp.billing_setting (
  id integer primary key default 1,
  trial_days integer not null default 30,
  due_days integer not null default 1,
  grace_days integer not null default 7,
  final_download_after_days integer not null default 90,
  retention_days integer not null default 365,
  yearly_months_charged integer not null default 10,
  commission_percent numeric(5, 2) not null default 50,
  commission_months integer not null default 12,
  attribution_window_days integer not null default 30,
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint billing_setting_single check (id = 1),
  constraint billing_setting_days check (trial_days between 0 and 365 and due_days between 0 and 365 and grace_days between 0 and 365),
  constraint billing_setting_commission check (commission_percent >= 0 and commission_percent <= 100 and commission_months between 0 and 120)
);
insert into dpdp.billing_setting (id) values (1) on conflict (id) do nothing;

create table if not exists dpdp.plan (
  key text primary key,
  account_type text not null check (account_type in ('firm', 'institution')),
  name text not null,
  max_clients integer not null default 0 check (max_clients >= 0),
  list_monthly_paise integer not null check (list_monthly_paise >= 0),
  offer_monthly_paise integer not null check (offer_monthly_paise >= 0),
  offer_starts_on date,
  offer_ends_on date,
  requires_verified boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint plan_offer_not_above_list check (offer_monthly_paise <= list_monthly_paise),
  constraint plan_offer_window check (offer_ends_on is null or offer_starts_on is null or offer_ends_on >= offer_starts_on)
);

-- Prices are per month, in paise, excluding GST. The offer window dates are a PLACEHOLDER chosen by the builder: the Owner must set the real
-- stated end date (update dpdp.plan set offer_ends_on = ...). After it, new sign-ups pay the list price; existing accounts keep theirs.
insert into dpdp.plan (key, account_type, name, max_clients, list_monthly_paise, offer_monthly_paise, offer_starts_on, offer_ends_on, requires_verified, sort_order) values
  ('institution',   'institution', 'Institution',            0,    80100,  39900, date '2026-10-06', date '2026-12-31', false, 10),
  ('firm_free',     'firm',        'Free (verified firms)',  0,        0,      0, null,              null,              true,  20),
  ('firm_starter',  'firm',        'Starter',               10,    80100,  39900, date '2026-10-06', date '2026-12-31', false, 30),
  ('firm_growth',   'firm',        'Growth',               100,   200100,  99900, date '2026-10-06', date '2026-12-31', false, 40),
  ('firm_practice', 'firm',        'Practice',             500,   400100, 199900, date '2026-10-06', date '2026-12-31', false, 50),
  ('firm_large',    'firm',        'Large',               1000,   600100, 299900, date '2026-10-06', date '2026-12-31', false, 60)
on conflict (key) do nothing;

-- A sales partner's code. It applies the ACTIVE OFFER (never more) and tags the sale to the partner. extra_percent_off stays 0 unless the
-- Owner sets it: no price below the offer without the Owner's approval.
create table if not exists dpdp.partner_offer_code (
  code text primary key,
  partner_identity_id text not null references dpdp.identity (id),
  extra_percent_off numeric(5, 2) not null default 0 check (extra_percent_off >= 0 and extra_percent_off <= 100),
  extra_approved_at timestamp,
  active boolean not null default true,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint partner_offer_code_shape check (code ~ '^[A-Z0-9]{4,16}$'),
  constraint partner_offer_code_extra_needs_approval check (extra_percent_off = 0 or extra_approved_at is not null)
);

-- ---------------------------------------------------------------------
-- 2. The account
-- ---------------------------------------------------------------------
create table if not exists dpdp.account (
  org_id text primary key references dpdp.organisation (id),
  account_type text not null check (account_type in ('firm', 'institution')),
  plan_key text not null references dpdp.plan (key),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  locked_monthly_paise integer not null check (locked_monthly_paise >= 0),
  opened_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  paid_until timestamp,
  first_paid_at timestamp,
  billing_contact_email text,
  professional_body text check (professional_body in ('ICAI', 'ICSI', 'ICMAI', 'other')),
  registration_no text,
  verification_status text not null default 'none' check (verification_status in ('none', 'pending', 'verified', 'rejected')),
  verification_requested_at timestamp,
  verified_at timestamp,
  source_kind text not null default 'none' check (source_kind in ('none', 'tracker', 'referral', 'partner')),
  source_tag text,
  attributed_identity_id text references dpdp.identity (id),
  partner_code text,
  attributed_at timestamp,
  final_download_sent_at timestamp,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint account_registration_len check (registration_no is null or char_length(registration_no) between 3 and 40),
  constraint account_source_tag_shape check (source_tag is null or source_tag ~ '^[a-z0-9_.-]{1,60}$')
);
create index if not exists dpdp_account_attributed_idx on dpdp.account (attributed_identity_id) where attributed_identity_id is not null;

create table if not exists dpdp.account_client (
  client_org_id text primary key references dpdp.organisation (id),
  firm_org_id text not null references dpdp.account (org_id),
  added_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create index if not exists dpdp_account_client_firm_idx on dpdp.account_client (firm_org_id);

create table if not exists dpdp.account_commission (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null references dpdp.organisation (id),
  payment_id text not null unique references dpdp.payment (id),
  partner_identity_id text not null references dpdp.identity (id),
  rate_percent numeric(5, 2) not null,
  base_paise integer not null check (base_paise > 0),
  amount_paise integer not null check (amount_paise >= 0),
  payout_status text not null default 'pending' check (payout_status in ('pending', 'paid')),
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create index if not exists dpdp_account_commission_partner_idx on dpdp.account_commission (partner_identity_id, payout_status);

-- Billing e-mail books. Same posture as dpdp.email_send: RLS on, no browser grant, reached only through the functions below.
create table if not exists dpdp.billing_email_optout (
  org_id text not null references dpdp.organisation (id),
  email_lower text not null,
  at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  primary key (org_id, email_lower)
);
create table if not exists dpdp.billing_notice_token (
  token_hash text primary key,
  org_id text not null references dpdp.organisation (id),
  email_lower text not null,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create table if not exists dpdp.billing_notice_sent (
  org_id text not null references dpdp.organisation (id),
  email_lower text not null,
  week_key text not null,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  primary key (org_id, email_lower, week_key)
);

alter table dpdp.billing_setting enable row level security;
alter table dpdp.plan enable row level security;
alter table dpdp.partner_offer_code enable row level security;
alter table dpdp.account enable row level security;
alter table dpdp.account_client enable row level security;
alter table dpdp.account_commission enable row level security;
alter table dpdp.billing_email_optout enable row level security;
alter table dpdp.billing_notice_token enable row level security;
alter table dpdp.billing_notice_sent enable row level security;
revoke all on dpdp.billing_setting, dpdp.plan, dpdp.partner_offer_code, dpdp.account, dpdp.account_client, dpdp.account_commission,
  dpdp.billing_email_optout, dpdp.billing_notice_token, dpdp.billing_notice_sent from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Pure helpers (dpdp schema: not callable from a browser)
-- ---------------------------------------------------------------------
-- THE state machine. Arguments only, so it can be tested at every boundary. E = the end of the paid period, or of the trial if never paid.
--   now <  E                  TRIAL (never paid) / ACTIVE (paid)
--   E <= now < E + due        DUE
--   .. < E + due + grace      GRACE
--   later                     LOCKED
-- A free verified firm is always ACTIVE.
create or replace function dpdp.billing_state_calc(
  p_free boolean, p_opened timestamp, p_paid_until timestamp, p_now timestamp, p_trial_days integer, p_due_days integer, p_grace_days integer
)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when coalesce(p_free, false) then 'ACTIVE'
    else (
      select case
        when p_now < e.at then case when p_paid_until is null then 'TRIAL' else 'ACTIVE' end
        when p_now < e.at + make_interval(days => p_due_days) then 'DUE'
        when p_now < e.at + make_interval(days => p_due_days + p_grace_days) then 'GRACE'
        else 'LOCKED'
      end
      from (select greatest(p_opened + make_interval(days => p_trial_days), coalesce(p_paid_until, '-infinity'::timestamp)) as at) e
    )
  end
$$;

create or replace function dpdp.offer_active(p_starts date, p_ends date, p_on date)
returns boolean
language sql immutable
set search_path = ''
as $$ select p_starts is not null and p_on >= p_starts and (p_ends is null or p_on <= p_ends) $$;

-- The monthly price (paise) a NEW sign-up pays for this plan on this date: the offer while it is running, else the list price.
create or replace function dpdp.plan_monthly_paise(p_plan_key text, p_on date, p_extra_percent_off numeric default 0)
returns integer
language sql stable
set search_path = ''
as $$
  select round(
    (case when dpdp.offer_active(p.offer_starts_on, p.offer_ends_on, p_on) then p.offer_monthly_paise else p.list_monthly_paise end)
    * (1 - least(greatest(coalesce(p_extra_percent_off, 0), 0), 100) / 100.0)
  )::integer
  from dpdp.plan p where p.key = p_plan_key
$$;

-- What one payment costs for a monthly price: a month, or a year = yearly_months_charged months (10).
create or replace function dpdp.charge_paise(p_monthly_paise integer, p_interval text)
returns integer
language sql stable
set search_path = ''
as $$
  select case p_interval
    when 'month' then p_monthly_paise
    when 'year' then p_monthly_paise * (select s.yearly_months_charged from dpdp.billing_setting s where s.id = 1)
  end
$$;

-- The account that covers an organisation: its own, or its firm's when it is a managed client. Null for an old organisation.
create or replace function dpdp.account_for_org(p_org_id text)
returns dpdp.account
language sql stable
set search_path = ''
as $$
  select a.*
  from dpdp.account a
  where a.org_id = coalesce((select c.firm_org_id from dpdp.account_client c where c.client_org_id = p_org_id), p_org_id)
$$;

create or replace function dpdp.account_is_free(p_account dpdp.account)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_account.verification_status = 'verified'
     and exists (select 1 from dpdp.plan p where p.key = p_account.plan_key and p.requires_verified and p.list_monthly_paise = 0)
$$;

create or replace function dpdp.org_billing_state(p_org_id text, p_now timestamp default null)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_a dpdp.account;
  v_s dpdp.billing_setting;
begin
  v_a := dpdp.account_for_org(p_org_id);
  if v_a.org_id is null then
    return 'ACTIVE';
  end if;
  select * into v_s from dpdp.billing_setting where id = 1;
  return dpdp.billing_state_calc(dpdp.account_is_free(v_a), v_a.opened_at, v_a.paid_until, coalesce(p_now, (clock_timestamp() at time zone 'UTC')),
    v_s.trial_days, v_s.due_days, v_s.grace_days);
end
$$;

-- The end of the paid period (or of the trial), E in the state machine.
create or replace function dpdp.account_period_end(p_account dpdp.account)
returns timestamp
language sql stable
set search_path = ''
as $$
  select greatest(p_account.opened_at + make_interval(days => s.trial_days), coalesce(p_account.paid_until, '-infinity'::timestamp))
  from dpdp.billing_setting s where s.id = 1
$$;

-- Calm wording, one place. The app (billing-state.ts) carries the same strings; a test compares them.
create or replace function dpdp.billing_due_line(p_state text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_state
    when 'DUE' then 'A gentle note: payment for this account is due. Everything keeps working while you sort it out.'
    when 'GRACE' then 'A gentle note: payment for this account is due. Everything still works for a few more days.'
    when 'LOCKED' then 'Payment for this account is due, so working screens are paused. Your data is safe. You can still pay, download your data, and record a breach, answer a grievance or honour a consent withdrawal.'
  end
$$;

-- Raise the plain refusal when the organisation's account is locked. errcode 42501 so the AI link maps it to 403 with this very message.
create or replace function dpdp.assert_not_locked(p_org_id text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if dpdp.org_billing_state(p_org_id) = 'LOCKED' then
    raise exception 'Payment is due for this account, so this screen is paused. Your data is safe. Open the Payment due screen to pay or to download your data.' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 4. The gate. dpdp__caller_membership is the one door every working RPC uses.
--    The always-open actions use dpdp__caller_membership_open, or set the allow flag (the wrappers in section 5).
-- ---------------------------------------------------------------------
create or replace function public.dpdp__caller_membership_open(p_org_id text default null)
returns dpdp.membership
language sql stable security definer
set search_path = ''
as $$
  select m.*
  from dpdp.membership m
  where m.identity_id = public.dpdp__caller_identity_id()
    and m.state = 'active'
    and (p_org_id is null or m.org_id = p_org_id)
  order by m.created_at desc
  limit 1
$$;

create or replace function public.dpdp__caller_membership(p_org_id text default null)
returns dpdp.membership
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is not null and coalesce(current_setting('dpdp.allow_locked', true), '') <> 'on' then
    perform dpdp.assert_not_locked(v_m.org_id);
  end if;
  return v_m;
end
$$;

revoke all on function public.dpdp__caller_membership_open(text) from public, anon, authenticated;
grant execute on function public.dpdp__caller_membership_open(text) to service_role, app_runtime;

-- The AI work link: one choke point (0607). A locked account's link refuses with the plain sentence (the Edge Function returns it as a 403).
create or replace function public.dpdp__ai_link_for_token(p_token text)
returns dpdp.ai_link
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_l dpdp.ai_link;
  v_org text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_hash := encode(sha256(convert_to(left(coalesce(p_token, ''), 256), 'UTF8')), 'hex');
  select l.* into v_l from dpdp.ai_link l where l.token_hash = v_hash;
  if v_l.id is null
     or v_l.membership_id is null
     or v_l.revoked_at is not null
     or v_l.expires_at <= v_now
     or not exists (select 1 from dpdp.membership m where m.id = v_l.membership_id and m.state = 'active') then
    raise exception 'This link has expired or was revoked' using errcode = '42501';
  end if;
  select m.org_id into v_org from dpdp.membership m where m.id = v_l.membership_id;
  perform dpdp.assert_not_locked(v_org);
  return v_l;
end
$$;
revoke all on function public.dpdp__ai_link_for_token(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Always-open wrappers around the money RPCs. The original body is renamed to a *_core function (guarded so a re-run never renames a
--    wrapper), the wrapper sets the allow flag for this transaction only and calls it.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dpdp__my_billing_core(text)') is null and to_regprocedure('public.dpdp_my_billing(text)') is not null then
    alter function public.dpdp_my_billing(text) rename to dpdp__my_billing_core;
  end if;
  if to_regprocedure('public.dpdp__declare_payment_core(text, integer, text, text, text, text)') is null and to_regprocedure('public.dpdp_declare_payment(text, integer, text, text, text, text)') is not null then
    alter function public.dpdp_declare_payment(text, integer, text, text, text, text) rename to dpdp__declare_payment_core;
  end if;
  if to_regprocedure('public.dpdp__pay_begin_core(text, text)') is null and to_regprocedure('public.dpdp_pay_begin(text, text)') is not null then
    alter function public.dpdp_pay_begin(text, text) rename to dpdp__pay_begin_core;
  end if;
end
$$;

create or replace function public.dpdp_my_billing(p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform set_config('dpdp.allow_locked', 'on', true);
  return public.dpdp__my_billing_core(p_org_id);
end
$$;

create or replace function public.dpdp_declare_payment(
  p_interval text, p_amount_paise integer, p_org_id text default null,
  p_reference text default null, p_proof_path text default null, p_note text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform set_config('dpdp.allow_locked', 'on', true);
  return public.dpdp__declare_payment_core(p_interval, p_amount_paise, p_org_id, p_reference, p_proof_path, p_note);
end
$$;

create or replace function public.dpdp_pay_begin(p_interval text, p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform set_config('dpdp.allow_locked', 'on', true);
  return public.dpdp__pay_begin_core(p_interval, p_org_id);
end
$$;

revoke all on function public.dpdp__my_billing_core(text) from public, anon, authenticated;
revoke all on function public.dpdp__declare_payment_core(text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp__pay_begin_core(text, text) from public, anon, authenticated;
grant execute on function public.dpdp__my_billing_core(text) to app_runtime;
grant execute on function public.dpdp__declare_payment_core(text, integer, text, text, text, text) to app_runtime;
grant execute on function public.dpdp__pay_begin_core(text, text) to app_runtime;
revoke all on function public.dpdp_my_billing(text) from public, anon;
revoke all on function public.dpdp_declare_payment(text, integer, text, text, text, text) from public, anon;
revoke all on function public.dpdp_pay_begin(text, text) from public, anon;
grant execute on function public.dpdp_my_billing(text) to authenticated, app_runtime;
grant execute on function public.dpdp_declare_payment(text, integer, text, text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_pay_begin(text, text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 6. Payments: every payment path (the owner's mark-paid, the claim approval, a future Razorpay webhook) inserts a dpdp.payment row, so
--    ONE trigger moves paid_until and writes the partner commission. A payment made while the account is LOCKED re-prices it to today's plan price.
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
  if v_a.source_kind = 'partner' and v_a.attributed_identity_id is not null and new.amount_paise > 0 then
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

drop trigger if exists account_on_payment on dpdp.payment;
create trigger account_on_payment after insert on dpdp.payment for each row execute function dpdp.account_on_payment();

-- ---------------------------------------------------------------------
-- 7. Open an account
-- ---------------------------------------------------------------------
create or replace function dpdp.clean_registration(p_text text)
returns text
language sql immutable
set search_path = ''
as $$ select nullif(btrim(coalesce(p_text, '')), '') $$;

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
  if v_body is not null and v_body not in ('ICAI', 'ICSI', 'ICMAI', 'other') then
    raise exception 'Professional body must be ICAI, ICSI, ICMAI or other' using errcode = '22023';
  end if;
  if (v_body is null) <> (v_reg is null) then
    raise exception 'Give both the professional body and the membership or firm registration number, or neither for now' using errcode = '22023';
  end if;
  if v_reg is not null and (char_length(v_reg) not between 3 and 40 or v_reg !~ '^[A-Za-z0-9/ ._-]+$') then
    raise exception 'The registration number looks wrong (3 to 40 letters, digits, / . - only)' using errcode = '22023';
  end if;
  if p_account_type = 'institution' and v_body is not null then
    raise exception 'A professional body number is only for a firm account' using errcode = '22023';
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
    professional_body, registration_no, verification_status, verification_requested_at,
    source_kind, source_tag, attributed_identity_id, partner_code, attributed_at
  ) values (
    v_org, p_account_type, v_plan, v_monthly, v_now, v_billing,
    v_body, v_reg, case when v_body is not null then 'pending' else 'none' end, case when v_body is not null then v_now end,
    v_kind, v_tag, v_attrib, v_partner_code, case when v_kind in ('partner', 'referral') then v_now end
  ) on conflict (org_id) do nothing;

  perform public.dpdp__append_event(v_org, v_identity, 'Owner', 'account_opened', 'Account opened as a ' || p_account_type || ' account', v_plan);
  if v_body is not null then
    perform public.dpdp__append_event(v_org, v_identity, 'Owner', 'firm_verification_requested', 'Professional membership details were given for checking', v_body);
  end if;
  if v_kind = 'partner' then
    perform public.dpdp__partner_notify(v_attrib, 'referred_signup', v_org, jsonb_build_object('edition', p_account_type), true);
  end if;

  return v_res || jsonb_build_object(
    'accountType', p_account_type, 'planKey', v_plan, 'monthlyPaise', v_monthly, 'listMonthlyPaise', v_list,
    'offerActive', (v_monthly < v_list), 'attribution', v_kind, 'verification', case when v_body is not null then 'pending' else 'none' end
  );
end
$$;

-- ---------------------------------------------------------------------
-- 8. Reading the account (any member; money only for the owner)
-- ---------------------------------------------------------------------
create or replace function public.dpdp__offer_label(p_list integer, p_offer integer)
returns text
language sql immutable
set search_path = ''
as $$ select case when p_list > 0 and p_offer < p_list then 'Festive offer: ' || round((1 - p_offer::numeric / p_list) * 100)::int || '% off' end $$;

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
    'verification', jsonb_build_object('status', v_a.verification_status, 'body', v_a.professional_body),
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

-- The plans, for the chooser. Public prices, so anon may read them. 'monthlyPaise' is what a NEW sign-up pays today.
create or replace function public.dpdp_public_plans()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', p.key, 'accountType', p.account_type, 'name', p.name, 'maxClients', p.max_clients, 'requiresVerified', p.requires_verified,
    'listMonthlyPaise', p.list_monthly_paise,
    'monthlyPaise', dpdp.plan_monthly_paise(p.key, (clock_timestamp() at time zone 'UTC')::date),
    'offerLabel', public.dpdp__offer_label(p.list_monthly_paise, dpdp.plan_monthly_paise(p.key, (clock_timestamp() at time zone 'UTC')::date)),
    'offerEndsOn', case when dpdp.offer_active(p.offer_starts_on, p.offer_ends_on, (clock_timestamp() at time zone 'UTC')::date) then to_char(p.offer_ends_on, 'YYYY-MM-DD') end,
    'yearlyMonthsCharged', (select s.yearly_months_charged from dpdp.billing_setting s where s.id = 1)
  ) order by p.sort_order), '[]'::jsonb)
  from dpdp.plan p where p.active
$$;

-- ---------------------------------------------------------------------
-- 9. The owner of an account: professional details, choosing a plan
-- ---------------------------------------------------------------------
create or replace function public.dpdp_account_set_professional(p_body text, p_registration_no text, p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_a dpdp.account;
  v_body text := dpdp.clean_registration(p_body);
  v_reg text := dpdp.clean_registration(p_registration_no);
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can give the firm''s professional details' using errcode = '42501';
  end if;
  select * into v_a from dpdp.account where org_id = v_m.org_id;
  if v_a.org_id is null or v_a.account_type <> 'firm' then
    raise exception 'Professional details are for a firm account' using errcode = '22023';
  end if;
  if v_body is null or v_body not in ('ICAI', 'ICSI', 'ICMAI', 'other') then
    raise exception 'Professional body must be ICAI, ICSI, ICMAI or other' using errcode = '22023';
  end if;
  if v_reg is null or char_length(v_reg) not between 3 and 40 or v_reg !~ '^[A-Za-z0-9/ ._-]+$' then
    raise exception 'The registration number looks wrong (3 to 40 letters, digits, / . - only)' using errcode = '22023';
  end if;
  if v_a.verification_status = 'verified' then
    raise exception 'This firm is already verified. Write to us if a detail needs to change.' using errcode = '22023';
  end if;
  update dpdp.account
  set professional_body = v_body, registration_no = v_reg, verification_status = 'pending', verification_requested_at = (clock_timestamp() at time zone 'UTC')
  where org_id = v_m.org_id;
  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Owner', 'firm_verification_requested', 'Professional membership details were given for checking', v_body);
  return jsonb_build_object('ok', true, 'status', 'pending');
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
  if v_p.requires_verified and v_a.verification_status <> 'verified' then
    raise exception 'The free plan is for verified firms. Give your professional details and we will check them.' using errcode = '22023';
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
-- 10. A firm adds a client organisation: the plan's cap, enforced here. The original function is renamed (guarded) and called last.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dpdp__create_client_org_core(text, text, text)') is null and to_regprocedure('public.dpdp_create_client_org(text, text, text)') is not null then
    alter function public.dpdp_create_client_org(text, text, text) rename to dpdp__create_client_org_core;
  end if;
end
$$;

create or replace function public.dpdp_create_client_org(p_name text, p_product text, p_owner_email text default null, p_firm_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_firms text[];
  v_firm text;
  v_cap integer;
  v_used integer;
  v_res jsonb;
begin
  v_identity := public.dpdp__caller_identity_id();
  select array_agg(a.org_id order by a.org_id) into v_firms
  from dpdp.account a
  join dpdp.membership m on m.org_id = a.org_id and m.identity_id = v_identity and m.state = 'active'
  where a.account_type = 'firm';
  if p_firm_org_id is not null then
    if v_firms is null or not (p_firm_org_id = any (v_firms)) then
      raise exception 'Not a member of that firm' using errcode = '42501';
    end if;
    v_firm := p_firm_org_id;
  elsif coalesce(array_length(v_firms, 1), 0) = 1 then
    v_firm := v_firms[1];
  elsif coalesce(array_length(v_firms, 1), 0) > 1 then
    raise exception 'Choose which firm this client belongs to' using errcode = '22023';
  end if;

  if v_firm is not null then
    perform dpdp.assert_not_locked(v_firm);
    select p.max_clients into v_cap from dpdp.account a join dpdp.plan p on p.key = a.plan_key where a.org_id = v_firm;
    select count(*)::int into v_used from dpdp.account_client c where c.firm_org_id = v_firm;
    if v_cap = 0 then
      raise exception 'Your plan is for your own firm''s file. To add client organisations, choose a plan that includes clients.' using errcode = '22023';
    elsif v_used >= v_cap then
      raise exception 'Your plan covers up to % client organisations. To add more, choose a bigger plan.', v_cap using errcode = '22023';
    end if;
  end if;

  v_res := public.dpdp__create_client_org_core(p_name, p_product, p_owner_email);
  if v_firm is not null then
    insert into dpdp.account_client (client_org_id, firm_org_id) values (v_res ->> 'orgId', v_firm) on conflict (client_org_id) do nothing;
    perform public.dpdp__append_event(v_firm, v_identity, 'Firm', 'client_added', 'A client organisation was added to this firm account', v_res ->> 'orgId');
  end if;
  return v_res;
end
$$;

revoke all on function public.dpdp__create_client_org_core(text, text, text) from public, anon, authenticated;
grant execute on function public.dpdp__create_client_org_core(text, text, text) to app_runtime;
revoke all on function public.dpdp_create_client_org(text, text, text, text) from public, anon;
grant execute on function public.dpdp_create_client_org(text, text, text, text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 11. The platform owner's actions (only dpdp__is_platform_admin, the 0658 pattern). All audited.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_pending_verifications()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'orgId', a.org_id, 'orgName', o.name, 'professionalBody', a.professional_body, 'registrationNo', a.registration_no,
      'requestedAt', a.verification_requested_at
    ) order by a.verification_requested_at), '[]'::jsonb)
    from dpdp.account a join dpdp.organisation o on o.id = a.org_id
    where a.account_type = 'firm' and a.verification_status = 'pending'
  );
end
$$;

create or replace function public.dpdp_owner_verify_firm(p_org_id text, p_decision text, p_note text default null)
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
  if p_decision is null or p_decision not in ('verified', 'rejected') then
    raise exception 'decision must be ''verified'' or ''rejected''' using errcode = '22023';
  end if;
  select * into v_a from dpdp.account where org_id = p_org_id;
  if v_a.org_id is null or v_a.account_type <> 'firm' then
    raise exception 'No such firm account' using errcode = '22023';
  end if;
  if v_a.professional_body is null or v_a.registration_no is null then
    raise exception 'This firm has not given its professional details yet' using errcode = '22023';
  end if;
  update dpdp.account
  set verification_status = p_decision,
      verified_at = case when p_decision = 'verified' then (clock_timestamp() at time zone 'UTC') end,
      -- a rejected firm cannot stay on the free plan: back to Starter at today's price
      plan_key = case when p_decision = 'rejected' and plan_key = 'firm_free' then 'firm_starter' else plan_key end,
      locked_monthly_paise = case when p_decision = 'rejected' and plan_key = 'firm_free'
        then dpdp.plan_monthly_paise('firm_starter', (clock_timestamp() at time zone 'UTC')::date) else locked_monthly_paise end
  where org_id = p_org_id;
  perform public.dpdp__append_event(p_org_id, null, 'Platform owner', 'firm_verification_' || p_decision,
    'Professional membership details were ' || case p_decision when 'verified' then 'verified' else 'not accepted' end,
    nullif(left(btrim(coalesce(p_note, '')), 200), ''));
  return jsonb_build_object('ok', true, 'status', p_decision);
end
$$;

-- "Mark paid": the owner saw the money. Books it through the one money function (0655), which flips the subscription, writes the payment and
-- the event; the payment trigger moves paid_until. p_paid_until overrides the computed date. A Razorpay webhook reaches the same path.
create or replace function public.dpdp_owner_mark_paid(
  p_org_id text, p_interval text default 'month', p_amount_paise integer default null, p_paid_until date default null,
  p_reference text default null, p_note text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_a dpdp.account;
  v_amount integer;
  v_booked jsonb;
  v_note text;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if p_interval is null or p_interval not in ('month', 'year') then
    raise exception 'interval must be ''month'' or ''year''' using errcode = '22023';
  end if;
  select * into v_a from dpdp.account where org_id = p_org_id;
  if v_a.org_id is null then
    raise exception 'No such account' using errcode = '22023';
  end if;
  v_amount := coalesce(p_amount_paise, dpdp.charge_paise(v_a.locked_monthly_paise, p_interval));
  if v_amount is null or v_amount <= 0 then
    raise exception 'There is nothing to pay on this plan' using errcode = '22023';
  end if;
  v_note := nullif(btrim(concat_ws('. ', case when nullif(btrim(coalesce(p_reference, '')), '') is not null then 'Ref ' || btrim(p_reference) end, btrim(coalesce(p_note, '')))), '');
  v_booked := public.dpdp_record_confirmed_payment(p_org_id, v_a.account_type, p_interval, v_amount, current_date, v_note);
  if p_paid_until is not null then
    update dpdp.account set paid_until = p_paid_until::timestamp where org_id = p_org_id;
  end if;
  perform public.dpdp__append_event(p_org_id, null, 'Platform owner', 'account_marked_paid', 'The account was marked paid', p_interval);
  return v_booked || jsonb_build_object('paidUntil', (select to_char(a.paid_until, 'YYYY-MM-DD') from dpdp.account a where a.org_id = p_org_id));
end
$$;

-- Edit a plan's prices and offer window (the table is editable by SQL too; this is the audited door).
create or replace function public.dpdp_owner_update_plan(
  p_key text, p_list_monthly_paise integer default null, p_offer_monthly_paise integer default null,
  p_offer_starts_on date default null, p_offer_ends_on date default null, p_clear_offer boolean default false
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_p dpdp.plan;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_p from dpdp.plan where key = p_key;
  if v_p.key is null then
    raise exception 'No such plan' using errcode = '22023';
  end if;
  update dpdp.plan set
    list_monthly_paise = coalesce(p_list_monthly_paise, list_monthly_paise),
    offer_monthly_paise = case when p_clear_offer then coalesce(p_list_monthly_paise, list_monthly_paise) else coalesce(p_offer_monthly_paise, offer_monthly_paise) end,
    offer_starts_on = case when p_clear_offer then null else coalesce(p_offer_starts_on, offer_starts_on) end,
    offer_ends_on = case when p_clear_offer then null else coalesce(p_offer_ends_on, offer_ends_on) end,
    updated_at = (clock_timestamp() at time zone 'UTC')
  where key = p_key;
  insert into dpdp.partner_event (identity_id, kind, summary, detail) values (null, 'plan_updated', 'A plan''s price or offer was changed', p_key);
  return jsonb_build_object('ok', true, 'key', p_key);
end
$$;

create or replace function public.dpdp_owner_set_partner_code(p_partner_identity_id text, p_code text, p_extra_percent_off numeric default 0, p_active boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_extra numeric := coalesce(p_extra_percent_off, 0);
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9]{4,16}$' then
    raise exception 'A code is 4 to 16 letters or digits' using errcode = '22023';
  end if;
  if not exists (select 1 from dpdp.sales_partner sp where sp.identity_id = p_partner_identity_id) then
    raise exception 'No such sales partner' using errcode = '22023';
  end if;
  if v_extra < 0 or v_extra > 100 then
    raise exception 'extra percent off must be between 0 and 100' using errcode = '22023';
  end if;
  -- Calling this function IS the owner's approval of any extra percentage.
  insert into dpdp.partner_offer_code (code, partner_identity_id, extra_percent_off, extra_approved_at, active)
  values (v_code, p_partner_identity_id, v_extra, case when v_extra > 0 then (clock_timestamp() at time zone 'UTC') end, coalesce(p_active, true))
  on conflict (code) do update set
    extra_percent_off = excluded.extra_percent_off, extra_approved_at = excluded.extra_approved_at, active = excluded.active
  where dpdp.partner_offer_code.partner_identity_id = excluded.partner_identity_id;
  insert into dpdp.partner_event (identity_id, kind, summary, detail) values (p_partner_identity_id, 'partner_offer_code_set', 'A partner offer code was set', null);
  return jsonb_build_object('ok', true, 'code', v_code);
end
$$;

-- ---------------------------------------------------------------------
-- 12. The always-open actions of a LOCKED account. They use the _open membership door on purpose.
--     A consent withdrawal (0725 dpdp_consent_withdraw) is by token, never touches the gate, and so is open by construction.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_locked_download(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can download the organisation''s data' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exportedAt', to_char((clock_timestamp() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'organisation', (select jsonb_build_object('id', o.id, 'name', o.name, 'edition', o.product) from dpdp.organisation o where o.id = v_m.org_id),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', ob.id, 'job', t.name, 'state', ob.state, 'dueOn', ob.due_on, 'naReason', ob.na_reason, 'closedAt', ob.closed_at
      ) order by ob.due_on, ob.id), '[]'::jsonb)
      from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id where ob.org_id = v_m.org_id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'summary', e.summary, 'detail', e.detail, 'by', e.actor_label, 'at', e.occurred_at
      ) order by e.occurred_at), '[]'::jsonb)
      from (select * from dpdp.event ev where ev.org_id = v_m.org_id order by ev.occurred_at desc limit 5000) e),
    'note', 'Documents are not kept by VERIDIAN: this file lists jobs and the dated record. Keep your own originals.'
  );
end
$$;

create or replace function public.dpdp_locked_record_breach(p_description text, p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_desc text := btrim(coalesce(p_description, ''));
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_desc = '' or char_length(v_desc) > 4000 then
    raise exception 'Describe what happened in a few sentences (up to 4000 characters)' using errcode = '22023';
  end if;
  insert into dpdp.breach (id, org_id, became_aware_at, deadline_at, state, description)
  values (v_id, v_m.org_id, v_now, v_now + interval '72 hours', 'open', v_desc);
  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Member', 'breach_recorded', 'A personal data breach was recorded', v_id);
  return jsonb_build_object('ok', true, 'breachId', v_id, 'boardDeadline', to_char(v_now + interval '72 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end
$$;

create or replace function public.dpdp_locked_answer_grievance(p_grievance_id text, p_decision text, p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_dec text := btrim(coalesce(p_decision, ''));
  v_n integer;
begin
  v_m := public.dpdp__caller_membership_open(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can answer a grievance' using errcode = '42501';
  end if;
  if v_dec = '' or char_length(v_dec) > 4000 then
    raise exception 'Write the answer in a few sentences (up to 4000 characters)' using errcode = '22023';
  end if;
  update dpdp.grievance set officer_decision = v_dec, state = 'answered'
  where (id = p_grievance_id or ref = p_grievance_id) and org_id = v_m.org_id and state = 'open';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No open grievance with that id' using errcode = '22023';
  end if;
  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Owner', 'grievance_answered', 'A grievance was answered', p_grievance_id);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 13. E-mails to the account's own contacts: owner, head of department, billing contact. They continue forever.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_timer_billing_due_line(p_org_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_state text := dpdp.org_billing_state(p_org_id);
begin
  if v_state not in ('DUE', 'GRACE', 'LOCKED') then
    return null;
  end if;
  return jsonb_build_object('state', v_state, 'line', dpdp.billing_due_line(v_state));
end
$$;

-- One row per contact per ISO week, for every account that is DUE, GRACE or LOCKED, minus anyone who opted out. Mints the one-click
-- unsubscribe token. finalDownload = this account is 90+ days past its period end and has not been sent the final download notice.
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
      from dpdp.account a
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

create or replace function public.dpdp_billing_notice_mark(p_org_id text, p_email text, p_week_key text, p_status text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'status must be sent or failed' using errcode = '22023';
  end if;
  update dpdp.billing_notice_sent set status = p_status
  where org_id = p_org_id and email_lower = lower(p_email) and week_key = p_week_key and status = 'claimed';
  return jsonb_build_object('ok', true, 'updated', found);
end
$$;

create or replace function public.dpdp_billing_final_download_mark(p_org_id text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  update dpdp.account set final_download_sent_at = (clock_timestamp() at time zone 'UTC') where org_id = p_org_id and final_download_sent_at is null;
  if found then
    perform public.dpdp__append_event(p_org_id, null, 'System', 'final_download_notice_sent', 'The final data-download notice was sent to the account contacts');
  end if;
  return jsonb_build_object('ok', true, 'marked', found);
end
$$;

-- One-click unsubscribe for a billing contact. Logged in the audit trail with NO address in the event.
create or replace function dpdp.billing_unsubscribe(p_token text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_t dpdp.billing_notice_token;
begin
  select t.* into v_t from dpdp.billing_notice_token t
   where t.token_hash = encode(sha256(convert_to(left(coalesce(p_token, ''), 256), 'UTF8')), 'hex');
  if v_t.token_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid.');
  end if;
  insert into dpdp.billing_email_optout (org_id, email_lower) values (v_t.org_id, v_t.email_lower) on conflict do nothing;
  if found then
    perform public.dpdp__append_event(v_t.org_id, null, 'A billing contact', 'billing_email_unsubscribed', 'A contact stopped the billing e-mails for this account');
  end if;
  return jsonb_build_object('ok', true, 'email', v_t.email_lower);
end
$$;

-- The existing unsubscribe page (0606) keeps working unchanged: a billing token starts with bn_, anything else goes the old way.
create or replace function public.dpdp_unsubscribe(p_token text)
returns jsonb
language sql volatile security definer
set search_path = ''
as $$ select case when left(coalesce(p_token, ''), 3) = 'bn_' then dpdp.billing_unsubscribe(p_token) else dpdp.unsubscribe(p_token) end $$;

-- ---------------------------------------------------------------------
-- 14. Grants
-- ---------------------------------------------------------------------
revoke all on function dpdp.billing_state_calc(boolean, timestamp, timestamp, timestamp, integer, integer, integer) from public, anon, authenticated;
revoke all on function dpdp.offer_active(date, date, date) from public, anon, authenticated;
revoke all on function dpdp.plan_monthly_paise(text, date, numeric) from public, anon, authenticated;
revoke all on function dpdp.charge_paise(integer, text) from public, anon, authenticated;
revoke all on function dpdp.account_for_org(text) from public, anon, authenticated;
revoke all on function dpdp.account_is_free(dpdp.account) from public, anon, authenticated;
revoke all on function dpdp.org_billing_state(text, timestamp) from public, anon, authenticated;
revoke all on function dpdp.account_period_end(dpdp.account) from public, anon, authenticated;
revoke all on function dpdp.billing_due_line(text) from public, anon, authenticated;
revoke all on function dpdp.assert_not_locked(text) from public, anon, authenticated;
revoke all on function dpdp.account_on_payment() from public, anon, authenticated;
revoke all on function dpdp.clean_registration(text) from public, anon, authenticated;
revoke all on function dpdp.billing_unsubscribe(text) from public, anon, authenticated;
grant execute on function dpdp.billing_state_calc(boolean, timestamp, timestamp, timestamp, integer, integer, integer) to service_role, app_runtime;
grant execute on function dpdp.org_billing_state(text, timestamp) to service_role, app_runtime;
grant execute on function dpdp.billing_due_line(text) to service_role, app_runtime;
grant execute on function dpdp.plan_monthly_paise(text, date, numeric) to service_role, app_runtime;
grant execute on function dpdp.charge_paise(integer, text) to service_role, app_runtime;
grant execute on function dpdp.billing_unsubscribe(text) to service_role, app_runtime;

revoke all on function public.dpdp__offer_label(integer, integer) from public, anon, authenticated;
grant execute on function public.dpdp__offer_label(integer, integer) to service_role, app_runtime;

revoke all on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text) from public, anon;
revoke all on function public.dpdp_my_account(text) from public, anon;
revoke all on function public.dpdp_public_plans() from public;
revoke all on function public.dpdp_account_set_professional(text, text, text) from public, anon;
revoke all on function public.dpdp_account_choose_plan(text, text, text) from public, anon;
revoke all on function public.dpdp_locked_download(text) from public, anon;
revoke all on function public.dpdp_locked_record_breach(text, text) from public, anon;
revoke all on function public.dpdp_locked_answer_grievance(text, text, text) from public, anon;
grant execute on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text) to authenticated, app_runtime;
grant execute on function public.dpdp_my_account(text) to authenticated, app_runtime;
grant execute on function public.dpdp_public_plans() to anon, authenticated, service_role, app_runtime;
grant execute on function public.dpdp_account_set_professional(text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_account_choose_plan(text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_locked_download(text) to authenticated, app_runtime;
grant execute on function public.dpdp_locked_record_breach(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_locked_answer_grievance(text, text, text) to authenticated, app_runtime;

-- Owner-only (each refuses unless dpdp__is_platform_admin(), like 0658's), reachable by an authenticated browser session.
revoke all on function public.dpdp_owner_pending_verifications() from public, anon;
revoke all on function public.dpdp_owner_verify_firm(text, text, text) from public, anon;
revoke all on function public.dpdp_owner_mark_paid(text, text, integer, date, text, text) from public, anon;
revoke all on function public.dpdp_owner_update_plan(text, integer, integer, date, date, boolean) from public, anon;
revoke all on function public.dpdp_owner_set_partner_code(text, text, numeric, boolean) from public, anon;
grant execute on function public.dpdp_owner_pending_verifications() to authenticated, app_runtime;
grant execute on function public.dpdp_owner_verify_firm(text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_mark_paid(text, text, integer, date, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_update_plan(text, integer, integer, date, date, boolean) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_set_partner_code(text, text, numeric, boolean) to authenticated, app_runtime;

-- Edge Function (service_role) side.
revoke all on function public.dpdp_timer_billing_due_line(text) from public, anon, authenticated;
revoke all on function public.dpdp_billing_due_worklist(timestamptz, integer, boolean) from public, anon, authenticated;
revoke all on function public.dpdp_billing_notice_mark(text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_billing_final_download_mark(text) from public, anon, authenticated;
grant execute on function public.dpdp_timer_billing_due_line(text) to service_role, app_runtime;
grant execute on function public.dpdp_billing_due_worklist(timestamptz, integer, boolean) to service_role, app_runtime;

-- ---------------------------------------------------------------------
-- 15. The weekly job: Mondays 04:30 UTC = 10:00 IST. Same request shape and Vault secrets as dpdp-sales-lifecycle (0673); cron.schedule upserts by name.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-billing-due',
      '30 4 * * 1',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-lifecycle-email'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"billing_due"}'::jsonb,
          timeout_milliseconds := 60000
        )
      $cron$
    );
  end if;
end
$$;
grant execute on function public.dpdp_billing_notice_mark(text, text, text, text) to service_role, app_runtime;
grant execute on function public.dpdp_billing_final_download_mark(text) to service_role, app_runtime;

revoke all on function public.dpdp_unsubscribe(text) from public;
grant execute on function public.dpdp_unsubscribe(text) to anon, authenticated, service_role, app_runtime;
