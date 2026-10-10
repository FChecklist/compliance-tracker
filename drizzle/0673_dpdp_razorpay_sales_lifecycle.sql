-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-10-01 -- "NEED TO INTEGRATE RAZORPAY ... COMPLETE THE FULL ... SALES LIFECYCLE, INTEGRATE AND GO LIVE"
--
-- DPDP online payment (Razorpay) and the trial/renewal reminder lifecycle.
-- Authorizes the SECURITY DEFINER functions and GRANT/REVOKE statements below and the
-- pg_cron job; NOT applied live by the session that wrote it -- the PM applies it after CI is
-- green (dpdp-app/OPERATIONS.md, "Online payment (Razorpay)").
--
-- NUMBERING: this file is 0673: 0672 is taken by the open AWL suggestions PR (#2025) and 0674 by the
-- parallel sales-partner work.
--
-- WHAT THIS ADDS (additive; nothing existing is changed in meaning):
--   dpdp.payment            + razorpay_payment_id (UNIQUE when set), method. The existing
--                             dpdp_record_confirmed_payment (0655) is still the ONE function that
--                             books money, flips the org active and creates the referral commission;
--                             the online path calls it, it does not re-implement it.
--   dpdp.payment_attempt    one row per "Pay online" press: what we ASKED Razorpay to charge
--                             (amount, currency, the Payment Link id). A webhook is believed only
--                             against this row. Never holds card data (none ever reaches us).
--   dpdp.razorpay_event     one row per webhook event we acted on or refused: an audit trail of
--                             money that arrived but was not booked (wrong amount, second payment...).
--   dpdp.sales_reminder_sent  one row per reminder per organisation per cycle, so each goes once.
--
--   public.dpdp_plan_price_paise / dpdp_billing_prices   the server-side price (see PRICE below).
--   public.dpdp_pay_begin                (authenticated)  owner-only: price + attempt row.
--   public.dpdp_pay_attempt_link/cancel  (service_role)   store / abandon the Razorpay link.
--   public.dpdp_pay_attempt_lookup       (service_role)   what a webhook's ids belong to.
--   public.dpdp_pay_confirm              (service_role)   record a captured payment, exactly once.
--   public.dpdp_pay_log_event            (service_role)   audit row for a refused/replayed event.
--   public.dpdp_sales_due_reminders / _claim / _mark (service_role)  the lifecycle worklist.
--   cron job `dpdp-sales-lifecycle`, 04:00 UTC daily, posts {"job":"sales_lifecycle"} to the
--       dpdp-lifecycle-email Edge Function with the same Vault secrets as dpdp-operator-digest.
--
-- PRICE. Until now the only copy of the price was a constant in the browser (BillingPanel.tsx).
-- dpdp_plan_price_paise is the server-side copy the payment path charges from, so a browser can
-- never choose its own amount. Both editions: yearly Rs 9,999 (999900 paise), monthly Rs 1,999
-- (199900 paise, shown for comparison; not actually sold). A bun test (dpdp-pay-logic.test.ts)
-- fails if this file and BillingPanel.tsx ever disagree.
--
-- ACCESS NEVER LOCKS (owner rule, 0655): nothing here reads or changes what an organisation may
-- do. A trial that ended, a payment still being confirmed and an active plan all behave the same.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
alter table dpdp.payment
  add column if not exists razorpay_payment_id text,
  add column if not exists method text;

create unique index if not exists dpdp_payment_razorpay_payment_id_key
  on dpdp.payment (razorpay_payment_id) where razorpay_payment_id is not null;

create table if not exists dpdp.payment_attempt (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null references dpdp.organisation(id),
  plan text not null check (plan in ('firm', 'institution')),
  "interval" text not null check ("interval" in ('month', 'year')),
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR',
  razorpay_payment_link_id text,
  razorpay_order_id text,
  short_url text,
  status text not null default 'created' check (status in ('created', 'paid', 'mismatch', 'expired', 'cancelled')),
  razorpay_payment_id text,
  method text,
  created_by_identity_id text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  paid_at timestamp,
  payment_id text references dpdp.payment(id)
);
create unique index if not exists dpdp_payment_attempt_link_key on dpdp.payment_attempt (razorpay_payment_link_id) where razorpay_payment_link_id is not null;
create unique index if not exists dpdp_payment_attempt_rzp_payment_key on dpdp.payment_attempt (razorpay_payment_id) where razorpay_payment_id is not null;
create index if not exists dpdp_payment_attempt_order_idx on dpdp.payment_attempt (razorpay_order_id) where razorpay_order_id is not null;
create index if not exists dpdp_payment_attempt_org_idx on dpdp.payment_attempt (org_id, created_at);

create table if not exists dpdp.razorpay_event (
  event_id text primary key,
  event_type text not null,
  razorpay_payment_id text,
  attempt_id text,
  outcome text not null check (outcome in ('recorded', 'duplicate', 'unknown_order', 'currency_mismatch', 'amount_mismatch', 'org_mismatch', 'attempt_already_paid')),
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);

create table if not exists dpdp.sales_reminder_sent (
  org_id text not null references dpdp.organisation(id),
  reminder_key text not null,
  to_email text,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  error text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  sent_at timestamp,
  primary key (org_id, reminder_key)
);

-- Same posture as dpdp.email_send (0606): not exposed to PostgREST, no policy for any browser role;
-- every read/write goes through a definer function below.
alter table dpdp.payment_attempt enable row level security;
alter table dpdp.razorpay_event enable row level security;
alter table dpdp.sales_reminder_sent enable row level security;
revoke all on dpdp.payment_attempt, dpdp.razorpay_event, dpdp.sales_reminder_sent from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Price (server-side)
-- ---------------------------------------------------------------------
create or replace function public.dpdp_plan_price_paise(p_plan text, p_interval text)
returns integer
language sql immutable
set search_path = ''
as $$
  select case
    when p_plan in ('firm', 'institution') and p_interval = 'year' then 999900
    when p_plan in ('firm', 'institution') and p_interval = 'month' then 199900
  end
$$;

create or replace function public.dpdp_billing_prices()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('currency', 'INR', 'yearPaise', 999900, 'monthPaise', 199900)
$$;

revoke all on function public.dpdp_plan_price_paise(text, text) from public, anon;
revoke all on function public.dpdp_billing_prices() from public, anon;
grant execute on function public.dpdp_plan_price_paise(text, text) to authenticated, service_role;
grant execute on function public.dpdp_billing_prices() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. The owner presses "Pay online"
-- ---------------------------------------------------------------------
create or replace function public.dpdp_pay_begin(p_interval text, p_org_id text default null)
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
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can pay for the organisation' using errcode = '42501';
  end if;
  if p_interval is distinct from 'year' then
    raise exception 'Online payment is for the yearly plan' using errcode = '22023';
  end if;
  select * into v_org from dpdp.organisation where id = v_m.org_id;
  if v_org.product is null or v_org.product not in ('firm', 'institution') then
    raise exception 'This organisation has no edition set yet' using errcode = '22023';
  end if;
  v_amount := public.dpdp_plan_price_paise(v_org.product, p_interval);
  if v_amount is null then
    raise exception 'No price is set for this plan' using errcode = '22023';
  end if;
  if (select count(*) from dpdp.payment_attempt a
      where a.org_id = v_m.org_id and a.created_at > (clock_timestamp() at time zone 'UTC') - interval '1 hour') >= 10 then
    raise exception 'Too many payment attempts in the last hour. Try again later, or pay by bank transfer.' using errcode = '22023';
  end if;

  v_attempt := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.payment_attempt (id, org_id, plan, "interval", amount_paise, created_by_identity_id)
  values (v_attempt, v_m.org_id, v_org.product, p_interval, v_amount, v_m.identity_id);

  select ie.email into v_email from dpdp.identity_email ie where ie.identity_id = v_m.identity_id and ie.is_primary limit 1;

  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Owner', 'payment_online_started',
    'Owner opened online payment: Rs ' || to_char(v_amount / 100.0, 'FM999999999.00') || ' (' || p_interval || 'ly)', p_interval);

  return jsonb_build_object(
    'attemptId', v_attempt, 'orgId', v_m.org_id, 'orgName', v_org.name, 'interval', p_interval,
    'amountPaise', v_amount, 'currency', 'INR', 'ownerEmail', v_email
  );
end
$$;

revoke all on function public.dpdp_pay_begin(text, text) from public, anon;
grant execute on function public.dpdp_pay_begin(text, text) to authenticated;

create or replace function public.dpdp_pay_attempt_link(p_attempt_id text, p_payment_link_id text, p_short_url text, p_order_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  update dpdp.payment_attempt
  set razorpay_payment_link_id = p_payment_link_id, short_url = p_short_url, razorpay_order_id = coalesce(p_order_id, razorpay_order_id)
  where id = p_attempt_id and status = 'created';
  if not found then
    raise exception 'No open payment attempt with that id' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Abandons an attempt whose Razorpay link could not be made. Only an attempt that never got a link.
create or replace function public.dpdp_pay_attempt_cancel(p_attempt_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  update dpdp.payment_attempt set status = 'cancelled'
  where id = p_attempt_id and status = 'created' and razorpay_payment_link_id is null;
  return jsonb_build_object('ok', true, 'cancelled', found);
end
$$;

-- ---------------------------------------------------------------------
-- 4. The webhook
-- ---------------------------------------------------------------------
-- What a webhook's ids belong to. Most specific match first: the payment-link id, then the order id,
-- then the reference id we set on the link (which IS our attempt id).
create or replace function public.dpdp_pay_attempt_lookup(p_payment_link_id text default null, p_order_id text default null, p_reference_id text default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'orgId', a.org_id, 'status', a.status, 'amountPaise', a.amount_paise,
    'currency', a.currency, 'razorpayPaymentId', a.razorpay_payment_id
  )
  from dpdp.payment_attempt a
  where (p_payment_link_id is not null and a.razorpay_payment_link_id = p_payment_link_id)
     or (p_order_id is not null and a.razorpay_order_id = p_order_id)
     or (p_reference_id is not null and a.id = p_reference_id)
  order by case
    when p_payment_link_id is not null and a.razorpay_payment_link_id = p_payment_link_id then 0
    when p_order_id is not null and a.razorpay_order_id = p_order_id then 1
    else 2 end
  limit 1
$$;

-- Audit row for an event we refused or saw again. Never overwrites a 'recorded' row.
create or replace function public.dpdp_pay_log_event(p_event_id text, p_event_type text, p_payment_id text, p_attempt_id text, p_outcome text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_event_id is null or trim(p_event_id) = '' then
    return jsonb_build_object('ok', false);
  end if;
  insert into dpdp.razorpay_event (event_id, event_type, razorpay_payment_id, attempt_id, outcome)
  values (p_event_id, coalesce(p_event_type, 'unknown'), p_payment_id, p_attempt_id, p_outcome)
  on conflict (event_id) do update set outcome = excluded.outcome, attempt_id = coalesce(excluded.attempt_id, dpdp.razorpay_event.attempt_id)
    where dpdp.razorpay_event.outcome <> 'recorded';
  return jsonb_build_object('ok', true);
end
$$;

-- Books ONE captured Razorpay payment, exactly once, in one transaction:
--   * the attempt row is locked, so two events for the same payment (payment.captured and
--     payment_link.paid both fire) cannot both pass the "not yet paid" check;
--   * the same Razorpay payment id is never booked twice (also enforced by a unique index);
--   * amount and currency must equal what the attempt asked for, else nothing is booked and the
--     attempt is marked 'mismatch' for the Owner to look at;
--   * the booking itself is dpdp_record_confirmed_payment (0655): org -> active, referral commission.
-- Refusals RETURN { ok:false, reason } (they do not raise), so the audit row and the 'mismatch'
-- mark commit. Only a genuine fault raises, which rolls everything back and lets Razorpay retry.
create or replace function public.dpdp_pay_confirm(
  p_event_id text, p_event_type text, p_payment_id text, p_payment_link_id text, p_order_id text,
  p_reference_id text, p_amount_paise integer, p_currency text, p_method text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a dpdp.payment_attempt;
  v_prior text;
  v_booked jsonb;
  v_pay_id text;
begin
  if p_payment_id is null or trim(p_payment_id) = '' then
    raise exception 'A payment id is required' using errcode = '22023';
  end if;
  if p_event_id is null or trim(p_event_id) = '' then
    raise exception 'An event id is required' using errcode = '22023';
  end if;

  -- A replay of an event we already booked.
  select e.outcome into v_prior from dpdp.razorpay_event e where e.event_id = p_event_id for update;
  if v_prior = 'recorded' then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select a.* into v_a
  from dpdp.payment_attempt a
  where (p_payment_link_id is not null and a.razorpay_payment_link_id = p_payment_link_id)
     or (p_order_id is not null and a.razorpay_order_id = p_order_id)
     or (p_reference_id is not null and a.id = p_reference_id)
  order by case
    when p_payment_link_id is not null and a.razorpay_payment_link_id = p_payment_link_id then 0
    when p_order_id is not null and a.razorpay_order_id = p_order_id then 1
    else 2 end
  limit 1
  for update;

  if v_a.id is null then
    perform public.dpdp_pay_log_event(p_event_id, p_event_type, p_payment_id, null, 'unknown_order');
    return jsonb_build_object('ok', false, 'reason', 'unknown_order');
  end if;

  -- Already booked (this exact Razorpay payment id): a quiet duplicate.
  if exists (select 1 from dpdp.payment p where p.razorpay_payment_id = p_payment_id) then
    perform public.dpdp_pay_log_event(p_event_id, p_event_type, p_payment_id, v_a.id, 'duplicate');
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  -- A DIFFERENT payment for an attempt that is already paid: real money, never auto-booked.
  if v_a.status = 'paid' then
    perform public.dpdp_pay_log_event(p_event_id, p_event_type, p_payment_id, v_a.id, 'attempt_already_paid');
    perform public.dpdp__append_event(v_a.org_id, null, 'System', 'payment_review_needed',
      'A second online payment arrived for an attempt that was already paid -- not booked, needs a look', p_payment_id);
    return jsonb_build_object('ok', false, 'reason', 'attempt_already_paid');
  end if;

  if upper(coalesce(p_currency, '')) <> upper(v_a.currency) then
    update dpdp.payment_attempt set status = 'mismatch' where id = v_a.id and status = 'created';
    perform public.dpdp_pay_log_event(p_event_id, p_event_type, p_payment_id, v_a.id, 'currency_mismatch');
    perform public.dpdp__append_event(v_a.org_id, null, 'System', 'payment_review_needed', 'An online payment arrived in the wrong currency -- not booked, needs a look', p_payment_id);
    return jsonb_build_object('ok', false, 'reason', 'currency_mismatch');
  end if;
  if p_amount_paise is distinct from v_a.amount_paise then
    update dpdp.payment_attempt set status = 'mismatch' where id = v_a.id and status = 'created';
    perform public.dpdp_pay_log_event(p_event_id, p_event_type, p_payment_id, v_a.id, 'amount_mismatch');
    perform public.dpdp__append_event(v_a.org_id, null, 'System', 'payment_review_needed', 'An online payment arrived for a different amount than asked -- not booked, needs a look', p_payment_id);
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  v_booked := public.dpdp_record_confirmed_payment(
    v_a.org_id, v_a.plan, v_a."interval", v_a.amount_paise, current_date, 'Paid online through Razorpay, payment ' || p_payment_id
  );
  v_pay_id := v_booked ->> 'paymentId';

  update dpdp.payment set razorpay_payment_id = p_payment_id, method = p_method where id = v_pay_id;
  update dpdp.payment_attempt
  set status = 'paid', razorpay_payment_id = p_payment_id, method = p_method, paid_at = (clock_timestamp() at time zone 'UTC'),
      payment_id = v_pay_id, razorpay_order_id = coalesce(razorpay_order_id, p_order_id)
  where id = v_a.id;
  perform public.dpdp_pay_log_event(p_event_id, p_event_type, p_payment_id, v_a.id, 'recorded');

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'paymentId', v_pay_id, 'orgId', v_a.org_id,
    'commissionId', v_booked -> 'commissionId', 'commissionAmountPaise', v_booked -> 'commissionAmountPaise'
  );
end
$$;

revoke all on function public.dpdp_pay_attempt_link(text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_pay_attempt_cancel(text) from public, anon, authenticated;
revoke all on function public.dpdp_pay_attempt_lookup(text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_pay_log_event(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_pay_confirm(text, text, text, text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.dpdp_pay_attempt_link(text, text, text, text) to service_role;
grant execute on function public.dpdp_pay_attempt_cancel(text) to service_role;
grant execute on function public.dpdp_pay_attempt_lookup(text, text, text) to service_role;
grant execute on function public.dpdp_pay_log_event(text, text, text, text, text) to service_role;
grant execute on function public.dpdp_pay_confirm(text, text, text, text, text, text, integer, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. The lifecycle worklist: who is due which reminder today
-- ---------------------------------------------------------------------
-- Trial: 10, 3 and 0 days before/at the end of the 30-day trial (= day 20, 27, 30). Renewal: 30 and 7
-- days before a yearly plan's anniversary (latest yearly payment + 1 year). To the ORGANISATION OWNER
-- only, to the earliest-joined active owner who has not unsubscribed.
--
-- Each reminder has a 3-day CATCH-UP WINDOW (the day it is due, plus the two after), so a cron
-- that was down for a day or two still sends it, and the windows of one cycle never overlap. The
-- window is also what keeps this from mass-mailing on first run: an organisation whose trial ended
-- months ago, or whose renewal is months away, is in no window and gets nothing. A reminder already
-- 'sent' (or claimed in the last 30 minutes) is not listed again. Reads only: sends nothing.
create or replace function public.dpdp_sales_due_reminders(p_now timestamptz default now(), p_limit integer default 500)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_now timestamp := coalesce(p_now, now()) at time zone 'UTC';
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_out jsonb;
begin
  with owners as (
    select distinct on (m.org_id) m.org_id, m.id as membership_id, m.identity_id, ie.email
    from dpdp.membership m
    join dpdp.identity_email ie on ie.identity_id = m.identity_id and ie.is_primary
    left join dpdp.email_preference ep on ep.membership_id = m.id
    where m.level = 'owner' and m.state = 'active' and ep.unsubscribed_at is null
    order by m.org_id, m.created_at asc
  ),
  due as (
    select s.org_id, k.kind, s.trial_ends_at as due_at
    from dpdp.subscription s
    cross join (values ('trial10', 10), ('trial3', 3), ('trial0', 0)) as k(kind, days)
    where s.state = 'trial' and s.trial_ends_at is not null
      and v_now >= s.trial_ends_at - make_interval(days => k.days)
      and v_now < s.trial_ends_at - make_interval(days => k.days) + interval '3 days'
    union all
    select s.org_id, k.kind, r.renews_at
    from dpdp.subscription s
    join lateral (
      select max(p.confirmed_at) + interval '1 year' as renews_at
      from dpdp.payment p where p.org_id = s.org_id and p."interval" = 'year'
    ) r on r.renews_at is not null
    cross join (values ('renew30', 30), ('renew7', 7)) as k(kind, days)
    where s.state = 'active' and s."interval" = 'year'
      and v_now >= r.renews_at - make_interval(days => k.days)
      and v_now < r.renews_at - make_interval(days => k.days) + interval '3 days'
  ),
  keyed as (
    select d.*, d.kind || ':' || to_char(d.due_at, 'YYYY-MM-DD') as reminder_key
    from due d
  ),
  open_ones as (
    select k.*, o.name as org_name, o.product, ow.email, ow.membership_id, ow.identity_id
    from keyed k
    join dpdp.organisation o on o.id = k.org_id
    join owners ow on ow.org_id = k.org_id
    left join dpdp.sales_reminder_sent sr on sr.org_id = k.org_id and sr.reminder_key = k.reminder_key
    where sr.org_id is null
       or sr.status = 'failed'
       or (sr.status = 'claimed' and sr.created_at < (clock_timestamp() at time zone 'UTC') - interval '30 minutes')
    order by k.due_at, k.org_id
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'orgId', x.org_id, 'orgName', x.org_name, 'product', x.product, 'kind', x.kind, 'reminderKey', x.reminder_key,
    'dueDate', to_char(x.due_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'daysLeft', greatest(0, ceil(extract(epoch from (x.due_at - v_now)) / 86400.0)::int),
    'ownerEmail', x.email, 'ownerMembershipId', x.membership_id, 'ownerIdentityId', x.identity_id
  ) order by x.due_at, x.org_id), '[]'::jsonb)
  into v_out
  from open_ones x;
  return v_out;
end
$$;

-- Take a reminder before sending it, so two overlapping runs cannot both send it. A 'failed' one (or one
-- claimed and then abandoned for 30 minutes) can be taken again; a 'sent' one never.
create or replace function public.dpdp_sales_reminder_claim(p_org_id text, p_reminder_key text, p_to_email text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_reminder_key is null or p_reminder_key !~ '^(trial10|trial3|trial0|renew30|renew7):[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Unknown reminder key' using errcode = '22023';
  end if;
  insert into dpdp.sales_reminder_sent (org_id, reminder_key, to_email, status)
  values (p_org_id, p_reminder_key, p_to_email, 'claimed')
  on conflict (org_id, reminder_key) do update
    set status = 'claimed', error = null, to_email = excluded.to_email, created_at = (clock_timestamp() at time zone 'UTC')
    where dpdp.sales_reminder_sent.status = 'failed'
       or (dpdp.sales_reminder_sent.status = 'claimed' and dpdp.sales_reminder_sent.created_at < (clock_timestamp() at time zone 'UTC') - interval '30 minutes');
  get diagnostics v_n = row_count;
  return jsonb_build_object('claimed', v_n = 1);
end
$$;

create or replace function public.dpdp_sales_reminder_mark(p_org_id text, p_reminder_key text, p_status text, p_error text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'status must be sent or failed' using errcode = '22023';
  end if;
  update dpdp.sales_reminder_sent
  set status = p_status, error = left(p_error, 500), sent_at = case when p_status = 'sent' then (clock_timestamp() at time zone 'UTC') end
  where org_id = p_org_id and reminder_key = p_reminder_key and status = 'claimed';
  return jsonb_build_object('ok', true, 'updated', found);
end
$$;

revoke all on function public.dpdp_sales_due_reminders(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dpdp_sales_reminder_claim(text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_sales_reminder_mark(text, text, text, text) from public, anon, authenticated;
grant execute on function public.dpdp_sales_due_reminders(timestamptz, integer) to service_role;
grant execute on function public.dpdp_sales_reminder_claim(text, text, text) to service_role;
grant execute on function public.dpdp_sales_reminder_mark(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 6. The daily job: 04:00 UTC = 09:30 IST. Same request shape and Vault secrets as
--    dpdp-operator-digest (0667): the URL secret points at dpdp-monday-email, so the function name is
--    swapped; the bearer is dpdp_timer_secret. cron.schedule upserts by name.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-sales-lifecycle',
      '0 4 * * *',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-lifecycle-email'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"sales_lifecycle"}'::jsonb,
          timeout_milliseconds := 60000
        )
      $cron$
    );
  end if;
end
$$;
