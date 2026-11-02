-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved the new DPDP pricing in chat on 2026-11-02 ("all approved", after the discussion of the
--   month-4 price jump, the large-firm rise, the trial client cap and no commission on the pack). Live facts checked the same day: 0 paid accounts,
--   0 payments, 0 rows in dpdp.account, so no customer's price changes. Applied by the PM through the Supabase MCP after the pull request is green.
--
-- DPDP PRICING: a Rs 99 three-month trial pack, then Rs 999 a month (yearly = half price), and for Professionals Rs 20 more a month for every
-- client beyond ten. NUMBERING: 0754 is the last on main, so this is 0755.
--
-- OWNER DECISIONS THIS FILE IMPLEMENTS (chat, 2026-11-02)
--   1. A new account has three ways to pay: trial pack | monthly | yearly. Once anything is paid, the pack is gone; only monthly | yearly remain.
--   2. Trial pack = Rs 99 for 90 days, the same for Professionals (firms) and Organisations (institutions). A Professional's pack, and its free
--      30 days, cover up to 10 clients. The pack earns no partner commission (commission is only on monthly and yearly payments).
--   3. Organisation: Rs 999 a month. Yearly = 50% off = 6 months charged = Rs 5,994 (dpdp.billing_setting.yearly_months_charged 10 -> 6).
--   4. Professional: Rs 999 a month includes 10 clients, plus Rs 20 a month for every extra client, counted on the ACTUAL number of clients at
--      the moment of each payment (no tiers). Yearly = 6 months of the same total (Rs 5,994 + Rs 120 per extra client).
--   5. The free plan (firm_free) is gone: nobody is ever free. The four tiers (firm_starter / firm_growth / firm_practice / firm_large) are
--      switched off (active = false) and replaced by one plan, 'firm'. Nothing is deleted, so a row that points at an old plan still resolves.
--
-- WHAT IT ADDS / CHANGES
--   dpdp.billing_setting   + pack_price_paise (9900), pack_days (90), pack_max_clients (10); yearly_months_charged 10 -> 6 (only if still 10).
--   dpdp.plan              + included_clients, extra_client_monthly_paise; new plan 'firm' (Rs 999, 10 clients, Rs 20 each extra); 'institution' -> Rs 999.
--   dpdp.account           + pack_paid_at. first_paid_at now means "first MONTHLY or YEARLY payment" (the partner-commission window and the
--                          client cap both start there); a pack payment sets pack_paid_at only.
--   interval 'pack'        allowed on dpdp.payment, dpdp.payment_attempt, dpdp.subscription (interval and self_declared_interval).
--   dpdp.account_client_cap / account_monthly_total_paise / account_charge_paise / account_pack_available / ensure_account   (new helpers)
--   dpdp.account_is_free   now always false.   dpdp.charge_paise   knows 'pack'.   dpdp.account_on_payment   pack = +pack_days days, no commission.
--   public.dpdp_record_confirmed_payment / dpdp__pay_begin_core / dpdp__declare_payment_core / dpdp_owner_mark_paid / dpdp_test_payment   take 'pack'.
--   public.dpdp_plan_price_paise / dpdp_billing_prices   the flat price of an organisation WITH NO ACCOUNT (and the number the reminder e-mails quote)
--                          now follows the plan table (Rs 5,994 a year / Rs 999 a month) instead of a typed Rs 9,999 / Rs 1,999.
--   public.dpdp_my_account / dpdp_public_plans   keep every old key and ADD the new ones (the screens already deployed keep working).
--   public.dpdp_create_client_org / dpdp_account_choose_plan / dpdp_account_save_profile / dpdp_owner_downgrade_firm   no free plan, new cap rule.
--   public.dpdp__open_account_core   a firm opens on plan 'firm'.
--   THE SIGN-UP TRAP (found 2026-11-02): public.dpdp_create_my_org (the plain sign-up, no account) made an organisation and a 30-day subscription
--   row but NO dpdp.account row, and dpdp.org_billing_state answers ACTIVE for an organisation with no account, so a person who signed up that way
--   was never billed. dpdp_open_account (what the app calls) already makes the account. The one-line fix: dpdp_create_my_org itself now makes the
--   account when it was NOT called from dpdp_open_account (the 'dpdp.terms_ok' flag is how it tells). Organisations that already exist are NOT
--   touched: with no account row they stay unbilled until the owner decides otherwise (see the pull request).
--
-- BACKWARD COMPATIBLE: every JSON key the deployed screens read is still there with the same meaning; new keys are added beside them. The Razorpay
-- edge function (supabase/functions/dpdp-pay) still asks for 'year' only until it is redeployed; the database already accepts the three.
-- Re-runnable: columns IF NOT EXISTS, constraints dropped and re-added, plan prices only changed while still at the old value, functions CREATE OR REPLACE.
-- Roll back: drizzle/down/0755_dpdp_pricing_trial_pack_and_per_client.down.sql

-- ---------------------------------------------------------------------
-- 1. Settings and plans
-- ---------------------------------------------------------------------
alter table dpdp.billing_setting add column if not exists pack_price_paise integer not null default 9900;
alter table dpdp.billing_setting add column if not exists pack_days integer not null default 90;
alter table dpdp.billing_setting add column if not exists pack_max_clients integer not null default 10;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_setting_pack' and conrelid = 'dpdp.billing_setting'::regclass) then
    alter table dpdp.billing_setting add constraint billing_setting_pack check (pack_price_paise > 0 and pack_days between 1 and 366 and pack_max_clients >= 0);
  end if;
end
$$;
-- Yearly = 50% off: six months charged. Only moved while it still holds the old value, so a later edit by the owner survives a re-run.
update dpdp.billing_setting set yearly_months_charged = 6, updated_at = (clock_timestamp() at time zone 'UTC') where id = 1 and yearly_months_charged = 10;

alter table dpdp.plan add column if not exists included_clients integer not null default 0 check (included_clients >= 0);
alter table dpdp.plan add column if not exists extra_client_monthly_paise integer not null default 0 check (extra_client_monthly_paise >= 0);

insert into dpdp.plan (key, account_type, name, max_clients, list_monthly_paise, offer_monthly_paise, offer_starts_on, offer_ends_on, requires_verified, sort_order, included_clients, extra_client_monthly_paise)
values ('firm', 'firm', 'Professional', 10, 99900, 99900, null, null, false, 20, 10, 2000)
on conflict (key) do nothing;

update dpdp.plan
set name = 'Organisation', list_monthly_paise = 99900, offer_monthly_paise = 99900, offer_starts_on = null, offer_ends_on = null, updated_at = (clock_timestamp() at time zone 'UTC')
where key = 'institution' and list_monthly_paise = 80100;

update dpdp.plan set active = false, updated_at = (clock_timestamp() at time zone 'UTC')
where key in ('firm_free', 'firm_starter', 'firm_growth', 'firm_practice', 'firm_large') and active;

-- ---------------------------------------------------------------------
-- 2. The account, and the new interval 'pack'
-- ---------------------------------------------------------------------
alter table dpdp.account add column if not exists pack_paid_at timestamp;

do $$
begin
  alter table dpdp.payment drop constraint if exists payment_interval_check;
  alter table dpdp.payment add constraint payment_interval_check check ("interval" in ('month', 'year', 'pack'));
  alter table dpdp.subscription drop constraint if exists subscription_interval_check;
  alter table dpdp.subscription add constraint subscription_interval_check check ("interval" in ('month', 'year', 'pack'));
  alter table dpdp.subscription drop constraint if exists subscription_self_declared_interval_check;
  alter table dpdp.subscription add constraint subscription_self_declared_interval_check check (self_declared_interval in ('month', 'year', 'pack'));
  if to_regclass('dpdp.payment_attempt') is not null then
    alter table dpdp.payment_attempt drop constraint if exists payment_attempt_interval_check;
    alter table dpdp.payment_attempt add constraint payment_attempt_interval_check check ("interval" in ('month', 'year', 'pack'));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Pure helpers (dpdp schema: not callable from a browser)
-- ---------------------------------------------------------------------
-- What one payment costs for a monthly price: a month, a year = yearly_months_charged months (6), or the trial pack (a flat price).
create or replace function dpdp.charge_paise(p_monthly_paise integer, p_interval text)
returns integer
language sql stable
set search_path = ''
as $$
  select case p_interval
    when 'month' then p_monthly_paise
    when 'year' then p_monthly_paise * (select s.yearly_months_charged from dpdp.billing_setting s where s.id = 1)
    when 'pack' then (select s.pack_price_paise from dpdp.billing_setting s where s.id = 1)
  end
$$;

-- Nobody is free any more (owner, 2026-11-02). Kept, always false, so the state machine and every caller keep their shape.
create or replace function dpdp.account_is_free(p_account dpdp.account)
returns boolean
language sql stable
set search_path = ''
as $$ select false $$;

-- How many client organisations a firm may add right now. NULL = no limit. An institution has none (0). A firm that has not yet paid a MONTHLY or
-- YEARLY plan (its free 30 days, or the trial pack) is held to pack_max_clients (10); once it pays monthly or yearly there is no cap and the price
-- follows the number of clients instead.
create or replace function dpdp.account_client_cap(p_account dpdp.account)
returns integer
language sql stable
set search_path = ''
as $$
  select case
    when p_account.account_type <> 'firm' then 0
    when p_account.first_paid_at is not null then null
    else (select s.pack_max_clients from dpdp.billing_setting s where s.id = 1)
  end
$$;

-- The pack is for an account that has paid nothing yet. After a pack, or any monthly/yearly payment, it is gone.
create or replace function dpdp.account_pack_available(p_account dpdp.account)
returns boolean
language sql stable
set search_path = ''
as $$ select p_account.first_paid_at is null and p_account.pack_paid_at is null $$;

-- The monthly total: the price the account signed up at, plus the plan's per-client price for every client beyond the included ones. The client
-- count is the real number of client organisations right now unless a caller passes one in.
create or replace function dpdp.account_monthly_total_paise(p_account dpdp.account, p_clients integer default null)
returns integer
language sql stable
set search_path = ''
as $$
  select p_account.locked_monthly_paise
       + greatest(coalesce(p_clients, (select count(*)::int from dpdp.account_client c where c.firm_org_id = p_account.org_id)) - p.included_clients, 0)
         * p.extra_client_monthly_paise
  from dpdp.plan p where p.key = p_account.plan_key
$$;

-- What ONE payment of this kind costs this account today: the pack (flat), a month (the monthly total), or a year (the monthly total x 6).
create or replace function dpdp.account_charge_paise(p_account dpdp.account, p_interval text, p_clients integer default null)
returns integer
language sql stable
set search_path = ''
as $$
  select case p_interval
    when 'pack' then (select s.pack_price_paise from dpdp.billing_setting s where s.id = 1)
    when 'month' then dpdp.account_monthly_total_paise(p_account, p_clients)
    when 'year' then dpdp.account_monthly_total_paise(p_account, p_clients) * (select s.yearly_months_charged from dpdp.billing_setting s where s.id = 1)
  end
$$;

-- An account for an organisation that has none, on the plan for its edition at today's price, trial running from now. Idempotent. True = made.
create or replace function dpdp.ensure_account(p_org_id text, p_product text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_plan text;
  v_n integer;
begin
  if p_org_id is null or p_product is null or p_product not in ('firm', 'institution') then
    return false;
  end if;
  v_plan := case p_product when 'institution' then 'institution' else 'firm' end;
  insert into dpdp.account (org_id, account_type, plan_key, locked_monthly_paise, opened_at)
  values (p_org_id, p_product, v_plan, coalesce(dpdp.plan_monthly_paise(v_plan, (clock_timestamp() at time zone 'UTC')::date), 0), (clock_timestamp() at time zone 'UTC'))
  on conflict (org_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$$;

-- ---------------------------------------------------------------------
-- 4. A payment: it moves paid-until and writes the partner commission. A PACK adds pack_days days and earns no commission.
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
  v_until := v_base + case new."interval" when 'year' then interval '12 months' when 'pack' then make_interval(days => v_s.pack_days) else interval '1 month' end;

  update dpdp.account
  set paid_until = v_until,
      first_paid_at = case when new."interval" = 'pack' then first_paid_at else coalesce(first_paid_at, new.confirmed_at) end,
      pack_paid_at = case when new."interval" = 'pack' then coalesce(pack_paid_at, new.confirmed_at) else pack_paid_at end,
      billing_interval = case when new."interval" = 'pack' then billing_interval else new."interval" end,
      locked_monthly_paise = case when v_prev = 'LOCKED' then coalesce(dpdp.plan_monthly_paise(v_a.plan_key, new.confirmed_at::date), locked_monthly_paise) else locked_monthly_paise end
  where org_id = new.org_id;

  -- The partner's commission: commission_percent of what was actually paid, for payments inside the first commission_months months after the
  -- first MONTHLY or YEARLY payment. Never on the trial pack. Only for a PARTNER-attributed account (a ?ref= referral keeps the 0655/0674 rule).
  if new."interval" <> 'pack' and v_a.source_kind = 'partner' and v_a.attributed_identity_id is not null and new.amount_paise > 0 and not coalesce(new.is_test, false) then
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

-- The one door every confirmed payment goes through (the owner's mark-paid, the claim approval, the Razorpay webhook). It now takes 'pack', and a
-- pack earns the referrer nothing (the first-month 5% waits for the first real monthly payment).
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
  if p_interval not in ('month', 'year', 'pack') then
    raise exception 'interval must be ''month'', ''year'' or ''pack''' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be a positive number' using errcode = '22023';
  end if;

  v_payment_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, period_start, confirmed_note)
  values (v_payment_id, p_org_id, p_plan, p_interval, p_amount_paise, coalesce(p_period_start, current_date), p_note);

  perform public.dpdp__append_event(p_org_id, null, 'System', 'payment_confirmed',
    'Payment confirmed: Rs ' || to_char(p_amount_paise / 100.0, 'FM999999999.00') || ' (' || p_plan || ', ' || case p_interval when 'pack' then 'trial pack' when 'year' then 'yearly' else 'monthly' end || ')', p_interval);

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
      if p_interval = 'pack' then
        null; -- the trial pack earns no commission (owner, 2026-11-02)
      elsif p_interval = 'year' then
        v_rate := 0.20;
        v_basis := 'yearly';
      elsif not exists (select 1 from dpdp.payment p2 where p2.org_id = p_org_id and p2.id <> v_payment_id and p2."interval" <> 'pack') then
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

-- ---------------------------------------------------------------------
-- 5. Opening an account. A firm opens on the one Professional plan.
-- ---------------------------------------------------------------------
create or replace function public.dpdp__open_account_core(
  p_account_type text, p_org_name text,
  p_professional_body text default null, p_registration_no text default null,
  p_referral_code text default null, p_partner_code text default null,
  p_source_tag text default null, p_first_seen_at timestamptz default null,
  p_billing_contact_email text default null
)
returns jsonb
language plpgsql security definer
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

  v_plan := case p_account_type when 'institution' then 'institution' else 'firm' end;
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

-- THE SIGN-UP TRAP. The plain sign-up (dpdp_create_my_org) used to make an organisation with NO account, and an organisation with no account is
-- never billed. When this wrapper is NOT being called from dpdp_open_account (that one sets 'dpdp.terms_ok' and makes its own account, with the
-- sign-up's source and price), it now makes the account itself. Guarded so a database that does not have the five-argument wrapper yet (0748 not
-- applied) is left alone.
do $do$
begin
  if to_regprocedure('public.dpdp_create_my_org(text, text, text, text, boolean)') is not null then
    execute $f$
      create or replace function public.dpdp_create_my_org(p_name text, p_product text, p_referral_code text default null, p_terms_version text default null, p_terms_accepted boolean default false)
      returns jsonb
      language plpgsql security definer
      set search_path = ''
      as $body$
      declare
        v_res jsonb;
      begin
        if coalesce(current_setting('dpdp.terms_ok', true), '') = 'on' then
          return public.dpdp__create_my_org_core(p_name, p_product, p_referral_code);
        end if;
        perform dpdp.terms_require('K2', p_terms_version, p_terms_accepted);
        v_res := public.dpdp__create_my_org_core(p_name, p_product, p_referral_code);
        perform dpdp.terms_record('K2', public.dpdp__caller_identity_id(), v_res ->> 'orgId', 'signup', p_terms_version);
        if coalesce((v_res ->> 'existing')::boolean, false) is not true then
          if dpdp.ensure_account(v_res ->> 'orgId', p_product) then
            perform public.dpdp__append_event(v_res ->> 'orgId', public.dpdp__caller_identity_id(), 'Owner', 'account_opened', 'Account opened as a ' || p_product || ' account',
              case p_product when 'institution' then 'institution' else 'firm' end);
          end if;
        end if;
        return v_res;
      end
      $body$
    $f$;
  end if;
end
$do$;

-- ---------------------------------------------------------------------
-- 6. Reading the account and the plans (old keys kept, new keys added)
-- ---------------------------------------------------------------------
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
  v_month integer;
  v_year integer;
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
  v_month := dpdp.account_charge_paise(v_a, 'month', v_used);
  v_year := dpdp.account_charge_paise(v_a, 'year', v_used);
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
    'clients', jsonb_build_object('used', v_used, 'cap', dpdp.account_client_cap(v_a), 'included', v_p.included_clients,
      'unlimited', v_a.account_type = 'firm' and dpdp.account_client_cap(v_a) is null),
    'verification', jsonb_build_object('status', v_a.verification_status, 'declared', v_a.verification_status = 'declared', 'body', v_a.professional_body,
      'registrationNo', case when v_owner and not v_covered then v_a.registration_no end),
    'profile', case when v_owner and not v_covered then dpdp.profile_progress(v_a.org_id, true) end,
    'isTest', v_a.is_test,
    'money', case when v_owner and not v_covered then jsonb_build_object(
      'interval', v_a.billing_interval,
      'monthlyPaise', v_month,
      'baseMonthlyPaise', v_a.locked_monthly_paise,
      'listMonthlyPaise', v_list,
      'offerLabel', public.dpdp__offer_label(v_list, v_a.locked_monthly_paise),
      'monthPaise', v_month,
      'yearPaise', v_year,
      'paidUntil', case when v_a.paid_until is null then null else to_char(v_a.paid_until, 'YYYY-MM-DD') end,
      'perClient', jsonb_build_object('includedClients', v_p.included_clients, 'extraMonthlyPaise', v_p.extra_client_monthly_paise,
        'clientsCounted', v_used, 'extraClients', greatest(v_used - v_p.included_clients, 0)),
      'pack', jsonb_build_object('available', dpdp.account_pack_available(v_a), 'pricePaise', v_s.pack_price_paise, 'days', v_s.pack_days,
        'maxClients', v_s.pack_max_clients, 'onPack', v_a.pack_paid_at is not null and v_a.first_paid_at is null),
      'yearlyMonthsCharged', v_s.yearly_months_charged
    ) end
  );
end
$$;

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
    'yearlyMonthsCharged', (select s.yearly_months_charged from dpdp.billing_setting s where s.id = 1),
    'includedClients', p.included_clients,
    'extraClientMonthlyPaise', p.extra_client_monthly_paise,
    'packPricePaise', (select s.pack_price_paise from dpdp.billing_setting s where s.id = 1),
    'packDays', (select s.pack_days from dpdp.billing_setting s where s.id = 1),
    'packMaxClients', (select s.pack_max_clients from dpdp.billing_setting s where s.id = 1)
  ) order by p.sort_order), '[]'::jsonb)
  from dpdp.plan p where p.active
$$;

-- ---------------------------------------------------------------------
-- 7. Choosing a plan, and a firm adding a client (the new cap rule)
-- ---------------------------------------------------------------------
create or replace function public.dpdp_account_choose_plan(p_plan_key text, p_interval text default 'month', p_org_id text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_a dpdp.account;
  v_p dpdp.plan;
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
  v_monthly := dpdp.plan_monthly_paise(v_p.key, (clock_timestamp() at time zone 'UTC')::date);
  update dpdp.account set plan_key = v_p.key, billing_interval = p_interval,
    locked_monthly_paise = case when v_p.key = v_a.plan_key then locked_monthly_paise else v_monthly end
  where org_id = v_a.org_id;
  perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'plan_chosen', 'Plan chosen: ' || v_p.key, p_interval);
  return jsonb_build_object('ok', true, 'planKey', v_p.key, 'monthlyPaise', case when v_p.key = v_a.plan_key then v_a.locked_monthly_paise else v_monthly end);
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
  v_acc dpdp.account;
  v_plan dpdp.plan;
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
    select * into v_acc from dpdp.account where org_id = v_firm;
    select * into v_plan from dpdp.plan where key = v_acc.plan_key;
    v_cap := dpdp.account_client_cap(v_acc);
    select count(*)::int into v_used from dpdp.account_client c where c.firm_org_id = v_firm;
    -- NULL cap = a firm that pays monthly or yearly: no limit, the price follows the number of clients.
    if v_cap = 0 then
      raise exception 'Your plan is for your own firm''s file. To add client organisations, choose a plan that includes clients.' using errcode = '22023';
    elsif v_cap is not null and v_used >= v_cap then
      raise exception 'Your trial pack covers up to % client organisations. To add more, start the monthly or yearly plan: it covers any number of clients (Rs % a month for each client beyond %).',
        v_cap, to_char(v_plan.extra_client_monthly_paise / 100.0, 'FM999999990'), v_plan.included_clients using errcode = '22023';
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

-- ---------------------------------------------------------------------
-- 8. Paying: online, by claim, by the platform owner, as a test
-- ---------------------------------------------------------------------
create or replace function public.dpdp__pay_begin_core(p_interval text, p_org_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_org dpdp.organisation;
  v_amount integer;
  v_attempt text;
  v_email text;
  v_acc dpdp.account;
  v_plan_key text;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can pay for the organisation' using errcode = '42501';
  end if;
  if p_interval is null or p_interval not in ('pack', 'month', 'year') then
    raise exception 'Choose the trial pack, a month or a year' using errcode = '22023';
  end if;
  select * into v_org from dpdp.organisation where id = v_m.org_id;
  if v_org.product is null or v_org.product not in ('firm', 'institution') then
    raise exception 'This organisation has no edition set yet' using errcode = '22023';
  end if;
  -- An account (dpdp.account) charges ITS price; an older organisation without one keeps the flat yearly price.
  v_acc := dpdp.account_for_org(v_m.org_id);
  if v_acc.org_id is not null then
    if v_acc.org_id <> v_m.org_id then
      raise exception 'This organisation is covered by its firm; the firm pays' using errcode = '22023';
    end if;
    if p_interval = 'pack' and not dpdp.account_pack_available(v_acc) then
      raise exception 'The trial pack is only for an account that has not paid yet. Choose a month or a year.' using errcode = '22023';
    end if;
    v_amount := dpdp.account_charge_paise(v_acc, p_interval);
    v_plan_key := v_acc.plan_key;
  else
    if p_interval is distinct from 'year' then
      raise exception 'Online payment for this organisation is for the yearly plan' using errcode = '22023';
    end if;
    v_amount := public.dpdp_plan_price_paise(v_org.product, p_interval);
    v_plan_key := v_org.product;
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'No price is set for this plan' using errcode = '22023';
  end if;
  if (select count(*) from dpdp.payment_attempt a
      where a.org_id = v_m.org_id and a.created_at > (clock_timestamp() at time zone 'UTC') - interval '1 hour') >= 10 then
    raise exception 'Too many payment attempts in the last hour. Try again later, or pay by bank transfer.' using errcode = '22023';
  end if;

  v_attempt := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.payment_attempt (id, org_id, plan, "interval", amount_paise, created_by_identity_id, product, variation)
  values (v_attempt, v_m.org_id, v_org.product, p_interval, v_amount, v_m.identity_id, 'veridian_dpdp', v_plan_key || '_' || p_interval);

  select ie.email into v_email from dpdp.identity_email ie where ie.identity_id = v_m.identity_id and ie.is_primary limit 1;

  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Owner', 'payment_online_started',
    'Owner opened online payment: Rs ' || to_char(v_amount / 100.0, 'FM999999999.00') || ' (' || case p_interval when 'pack' then 'trial pack' when 'year' then 'yearly' else 'monthly' end || ')', p_interval);

  return jsonb_build_object(
    'attemptId', v_attempt, 'orgId', v_m.org_id, 'plan', v_org.product, 'variation', v_plan_key || '_' || p_interval, 'orgName', v_org.name, 'interval', p_interval,
    'amountPaise', v_amount, 'currency', 'INR', 'ownerEmail', v_email
  );
end
$$;

create or replace function public.dpdp__declare_payment_core(
  p_interval text, p_amount_paise integer, p_org_id text default null,
  p_reference text default null, p_proof_path text default null, p_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_acc dpdp.account;
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can record a payment' using errcode = '42501';
  end if;
  if p_interval is null or p_interval not in ('pack', 'month', 'year') then
    raise exception 'interval must be ''pack'', ''month'' or ''year''' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be a positive number' using errcode = '22023';
  end if;
  if p_interval = 'pack' then
    v_acc := dpdp.account_for_org(v_m.org_id);
    if v_acc.org_id is null or v_acc.org_id <> v_m.org_id or not dpdp.account_pack_available(v_acc) then
      raise exception 'The trial pack is only for an account that has not paid yet. Choose a month or a year.' using errcode = '22023';
    end if;
  end if;

  insert into dpdp.subscription (
    org_id, trial_ends_at, state, "interval",
    self_declared_at, self_declared_interval, self_declared_amount_paise,
    self_declared_reference, self_declared_proof_path, self_declared_note
  )
  values (
    v_m.org_id, (clock_timestamp() at time zone 'UTC'), 'awaiting_confirmation', p_interval,
    (clock_timestamp() at time zone 'UTC'), p_interval, p_amount_paise,
    v_reference, p_proof_path, v_note
  )
  on conflict (org_id) do update set
    state = 'awaiting_confirmation', "interval" = p_interval,
    self_declared_at = (clock_timestamp() at time zone 'UTC'), self_declared_interval = p_interval, self_declared_amount_paise = p_amount_paise,
    self_declared_reference = v_reference, self_declared_proof_path = p_proof_path, self_declared_note = v_note;

  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Owner',
    'payment_declared',
    'Owner said they paid Rs ' || to_char(p_amount_paise / 100.0, 'FM999999999.00') || ' (' || case p_interval when 'pack' then 'trial pack' when 'year' then 'yearly' else 'monthly' end || ') -- awaiting confirmation',
    p_interval);

  return jsonb_build_object('ok', true, 'state', 'awaiting_confirmation');
end
$$;

create or replace function public.dpdp_owner_mark_paid(
  p_org_id text, p_interval text default 'month', p_amount_paise integer default null, p_paid_until date default null,
  p_reference text default null, p_note text default null
)
returns jsonb
language plpgsql security definer
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
  if p_interval is null or p_interval not in ('pack', 'month', 'year') then
    raise exception 'interval must be ''pack'', ''month'' or ''year''' using errcode = '22023';
  end if;
  select * into v_a from dpdp.account where org_id = p_org_id;
  if v_a.org_id is null then
    raise exception 'No such account' using errcode = '22023';
  end if;
  if p_interval = 'pack' and not dpdp.account_pack_available(v_a) then
    raise exception 'The trial pack is only for an account that has not paid yet' using errcode = '22023';
  end if;
  v_amount := coalesce(p_amount_paise, dpdp.account_charge_paise(v_a, p_interval));
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

create or replace function public.dpdp_test_payment(p_interval text default 'month', p_org_id text default null)
returns jsonb
language plpgsql security definer
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
  if p_interval is null or p_interval not in ('pack', 'month', 'year') then
    raise exception 'interval must be ''pack'', ''month'' or ''year''' using errcode = '22023';
  end if;
  v_a := dpdp.account_for_org(v_m.org_id);
  if v_a.org_id is null then
    raise exception 'This organisation has no account' using errcode = '22023';
  end if;
  if not dpdp.org_is_test(v_a.org_id) then
    raise exception 'A test payment can only be recorded on a test account' using errcode = '22023';
  end if;
  if p_interval = 'pack' and not dpdp.account_pack_available(v_a) then
    raise exception 'The trial pack is only for an account that has not paid yet' using errcode = '22023';
  end if;
  v_amount := dpdp.account_charge_paise(v_a, p_interval);
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
-- 8b. The flat price for an organisation that has NO account (made before billing, or any that still pays online without one). It used to be a typed
--     Rs 9,999 a year / Rs 1,999 a month for everyone, which would now contradict every price the product shows. It follows the plan table instead, so
--     there is one number: the plan's monthly price and the same half-price year. dpdp_billing_prices feeds the trial and renewal reminder e-mails
--     (supabase/functions/dpdp-lifecycle-email). SECURITY DEFINER because the plan table is not readable by the roles that call these.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_plan_price_paise(p_plan text, p_interval text)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_plan in ('firm', 'institution') and p_interval in ('pack', 'month', 'year')
      then dpdp.charge_paise(dpdp.plan_monthly_paise(p_plan, (clock_timestamp() at time zone 'UTC')::date), p_interval)
  end
$$;

create or replace function public.dpdp_billing_prices()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'currency', 'INR',
    'yearPaise', public.dpdp_plan_price_paise('institution', 'year'),
    'monthPaise', public.dpdp_plan_price_paise('institution', 'month'),
    'packPaise', public.dpdp_plan_price_paise('institution', 'pack')
  )
$$;

-- ---------------------------------------------------------------------
-- 9. The practitioner declaration no longer buys a free plan; the owner's downgrade has no free plan to move from.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_account_save_profile(p_profile jsonb, p_org_id text default null)
returns jsonb
language plpgsql security definer
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

  -- "I am a practising CA / CS / cost accountant": a record only. It used to buy the free plan; there is no free plan any more (owner, 2026-11-02).
  if v_p ? 'practitionerDeclared' and jsonb_typeof(v_p -> 'practitionerDeclared') = 'boolean' then
    v_decl := (v_p ->> 'practitionerDeclared')::boolean;
    if v_a.account_type <> 'firm' then
      v_ignored := array_append(v_ignored, 'practitionerDeclared'::text);
    elsif v_decl and v_a.verification_status = 'downgraded' then
      v_note := 'This account is on a paid plan. Write to us if that is a mistake.';
      v_ignored := array_append(v_ignored, 'practitionerDeclared'::text);
    elsif v_decl and v_a.verification_status <> 'declared' then
      update dpdp.account set verification_status = 'declared', declared_at = v_now where org_id = v_a.org_id;
      perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'firm_self_declared', 'The firm declared that it is a practising CA, CS or cost accountant', v_body);
    elsif not v_decl and v_a.verification_status = 'declared' then
      update dpdp.account set verification_status = 'none', declared_at = null where org_id = v_a.org_id;
      perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'firm_declaration_withdrawn', 'The practitioner declaration was withdrawn', null);
    end if;
  end if;

  perform public.dpdp__append_event(v_a.org_id, v_m.identity_id, 'Owner', 'account_profile_saved', 'Account details were updated', null);
  return jsonb_build_object('ok', true, 'ignored', to_jsonb(v_ignored), 'note', v_note,
    'status', (select a.verification_status from dpdp.account a where a.org_id = v_a.org_id),
    'planKey', (select a.plan_key from dpdp.account a where a.org_id = v_a.org_id),
    'profile', dpdp.profile_progress(v_a.org_id, true));
end
$$;

create or replace function public.dpdp_owner_downgrade_firm(p_org_id text, p_note text default null)
returns jsonb
language plpgsql security definer
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
      plan_key = case when plan_key = 'firm_free' then 'firm' else plan_key end,
      locked_monthly_paise = case when plan_key = 'firm_free' then dpdp.plan_monthly_paise('firm', (clock_timestamp() at time zone 'UTC')::date) else locked_monthly_paise end
  where org_id = p_org_id;
  perform public.dpdp__append_event(p_org_id, null, 'Platform owner', 'firm_downgraded', 'The account was moved to a paid plan after a review', nullif(left(btrim(coalesce(p_note, '')), 200), ''));
  perform dpdp.platform_audit('firm_downgraded', jsonb_build_object('orgId', p_org_id));
  return jsonb_build_object('ok', true, 'status', 'downgraded', 'planKey', (select a.plan_key from dpdp.account a where a.org_id = p_org_id));
end
$$;

-- ---------------------------------------------------------------------
-- 10. Who can run the new helpers: only the database itself, from inside the doors above (the same shape 0734 gave its own helpers). The public
--     doors this file redefines keep the grants they already had.
-- ---------------------------------------------------------------------
revoke all on function dpdp.ensure_account(text, text) from public, anon, authenticated;
revoke all on function dpdp.account_client_cap(dpdp.account) from public, anon, authenticated;
revoke all on function dpdp.account_pack_available(dpdp.account) from public, anon, authenticated;
revoke all on function dpdp.account_monthly_total_paise(dpdp.account, integer) from public, anon, authenticated;
revoke all on function dpdp.account_charge_paise(dpdp.account, text, integer) from public, anon, authenticated;
