-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order 2026-10-13: payment ledger A/B/C, checklist L8-L11) -- DPDP's own payment ledger (C), tied to Razorpay (A) and the central ledger (B). Written, reviewed, then applied by the project manager; repeat-safe.
-- 0749: Veridian DPDP ledger C.
--
-- WHAT THIS ADDS (additive; nothing existing changes meaning; every statement can run twice with the same result):
--   dpdp.payment_attempt.txn_id        GENERATED column = 'DPD-dpdp_' || id. The one id that ties Razorpay (order notes + receipt), the central ledger and this database
--                                      together for one "Pay online" press. Generated, so it exists from the moment dpdp_pay_begin inserts the attempt and can never drift.
--   dpdp.ledger_payment_attempt        one row per RAZORPAY payment attempt (rzp_payment_id PRIMARY KEY): success AND failure, with method, bank, masked card / UPI,
--                                      rrn, Razorpay's error fields, fee and GST on the fee, and the times. Status only moves forward (failed -> authorized -> captured).
--   dpdp.ledger_refund                 one row per Razorpay refund (rzp_refund_id PRIMARY KEY).
--   dpdp.ledger_event_seen             Razorpay's x-razorpay-event-id (or a derived key): a repeated delivery is processed once.
--   dpdp.ledger_commission_sync        what was last told to the central ledger about each referral commission (accrued / paid), so a change is sent once and a failure is retried.
--   dpdp.ledger_state                  last push / last try of the monthly figures to the central ledger (at most every 30 minutes).
--   All five tables: row level security ON, no policy, no grant to anon / authenticated. Only the SECURITY DEFINER functions below touch them.
--
--   public.dpdp_ledger_record_attempt / _record_refund     (service_role)  the edge function dpdp-pay writes what Razorpay says.
--   public.dpdp_ledger_event_seen / _mark_event            (service_role)  the repeat-delivery guard.
--   public.dpdp_ledger_month_figures                       (service_role)  current + previous Indian month, in the shape of the central POST /api/pay/site-summary.
--   public.dpdp_ledger_summary_claim / _summary_done       (service_role)  the "at most every 30 minutes" rule, taken atomically.
--   public.dpdp_ledger_commissions_to_post / _commission_mark (service_role) the worklist for the central POST /api/pay/commission.
--   public.dpdp_owner_ledger(month)                        (authenticated, platform owner only: dpdp__is_platform_admin) the owner's report. No payer e-mail anywhere in it.
--   cron job dpdp-ledger-tick, every 30 minutes: posts to dpdp-pay/ledger-tick with the same Vault bearer the other DPDP jobs use.
--
-- NOT changed: dpdp_pay_begin, dpdp_pay_confirm, dpdp_record_confirmed_payment (the booking path is exactly as before).

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
alter table dpdp.payment_attempt
  add column if not exists txn_id text generated always as ('DPD-dpdp_' || id) stored;

create table if not exists dpdp.ledger_payment_attempt (
  rzp_payment_id text primary key,
  attempt_id text,
  txn_id text,
  rzp_order_id text,
  status text not null check (status in ('authorized', 'captured', 'failed')),
  currency text,
  amount_paise integer,
  method text,
  bank text,
  wallet text,
  card_network text,
  card_type text,
  card_last4 text,
  card_issuer text,
  vpa_masked text,
  rrn text,
  auth_code text,
  is_international boolean,
  error_code text,
  error_description text,
  error_source text,
  error_step text,
  error_reason text,
  fee_paise integer,
  tax_paise integer,
  authorized_at timestamptz,
  captured_at timestamptz,
  failed_at timestamptz,
  event_at timestamptz,
  rzp_created_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dpdp_ledger_payment_attempt_attempt_idx on dpdp.ledger_payment_attempt (attempt_id) where attempt_id is not null;
create index if not exists dpdp_ledger_payment_attempt_order_idx on dpdp.ledger_payment_attempt (rzp_order_id) where rzp_order_id is not null;
create index if not exists dpdp_ledger_payment_attempt_txn_idx on dpdp.ledger_payment_attempt (txn_id) where txn_id is not null;

create table if not exists dpdp.ledger_refund (
  rzp_refund_id text primary key,
  rzp_payment_id text not null,
  attempt_id text,
  txn_id text,
  currency text,
  amount_paise integer not null check (amount_paise >= 0),
  status text not null check (status in ('pending', 'processed', 'failed')),
  created_at_rzp timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dpdp_ledger_refund_payment_idx on dpdp.ledger_refund (rzp_payment_id);

create table if not exists dpdp.ledger_event_seen (
  rzp_event_id text primary key,
  event text,
  seen_at timestamptz not null default now()
);

create table if not exists dpdp.ledger_commission_sync (
  commission_id text primary key,
  sync_status text check (sync_status in ('accrued', 'paid')),
  synced_at timestamptz,
  try_at timestamptz,
  error text
);

create table if not exists dpdp.ledger_state (
  k text primary key,
  at timestamptz not null
);

alter table dpdp.ledger_payment_attempt enable row level security;
alter table dpdp.ledger_refund enable row level security;
alter table dpdp.ledger_event_seen enable row level security;
alter table dpdp.ledger_commission_sync enable row level security;
alter table dpdp.ledger_state enable row level security;
revoke all on dpdp.ledger_payment_attempt, dpdp.ledger_refund, dpdp.ledger_event_seen, dpdp.ledger_commission_sync, dpdp.ledger_state from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Recording what Razorpay says (A -> C)
-- ---------------------------------------------------------------------
create or replace function public.dpdp__ledger_rank(p_status text)
returns integer
language sql immutable
set search_path = ''
as $$ select case p_status when 'captured' then 3 when 'authorized' then 2 else 1 end $$;

-- One Razorpay payment attempt, from a webhook message or from a payment Razorpay returned. Idempotent: the same payment id is one row however many
-- messages arrive; the status only moves forward; the first failure reason / bank reference / time is kept.
create or replace function public.dpdp_ledger_record_attempt(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text := nullif(trim(coalesce(p ->> 'rzpPaymentId', '')), '');
  v_status text := p ->> 'status';
  v_order text := nullif(p ->> 'orderId', '');
  v_att text;
  v_txn text;
  v_ev timestamptz := to_timestamp(coalesce(nullif(p ->> 'eventMs', '')::numeric, extract(epoch from now()) * 1000) / 1000.0);
begin
  if v_id is null then
    raise exception 'A Razorpay payment id is required' using errcode = '22023';
  end if;
  if v_status is null or v_status not in ('authorized', 'captured', 'failed') then
    raise exception 'status must be authorized, captured or failed' using errcode = '22023';
  end if;

  -- Which "Pay online" press this belongs to: by the order we opened, else by the attempt id we wrote in the order notes.
  if v_order is not null then
    select a.id into v_att from dpdp.payment_attempt a where a.razorpay_order_id = v_order order by a.created_at limit 1;
  end if;
  if v_att is null and nullif(p ->> 'attemptHint', '') is not null then
    select a.id into v_att from dpdp.payment_attempt a where a.id = p ->> 'attemptHint';
  end if;
  v_txn := case when v_att is null then null else 'DPD-dpdp_' || v_att end;

  insert into dpdp.ledger_payment_attempt as t (
    rzp_payment_id, attempt_id, txn_id, rzp_order_id, status, currency, amount_paise, method, bank, wallet, card_network, card_type, card_last4, card_issuer, vpa_masked, rrn, auth_code,
    is_international, error_code, error_description, error_source, error_step, error_reason, fee_paise, tax_paise, authorized_at, captured_at, failed_at, event_at, rzp_created_at
  ) values (
    v_id, v_att, v_txn, v_order, v_status, upper(nullif(p ->> 'currency', '')), nullif(p ->> 'amountPaise', '')::integer, nullif(p ->> 'method', ''), nullif(p ->> 'bank', ''), nullif(p ->> 'wallet', ''),
    nullif(p ->> 'cardNetwork', ''), nullif(p ->> 'cardType', ''), nullif(p ->> 'cardLast4', ''), nullif(p ->> 'cardIssuer', ''), nullif(p ->> 'vpaMasked', ''), nullif(p ->> 'rrn', ''), nullif(p ->> 'authCode', ''),
    nullif(p ->> 'international', '')::boolean, nullif(p ->> 'errorCode', ''), nullif(p ->> 'errorDescription', ''), nullif(p ->> 'errorSource', ''), nullif(p ->> 'errorStep', ''), nullif(p ->> 'errorReason', ''),
    nullif(p ->> 'feePaise', '')::integer, nullif(p ->> 'taxPaise', '')::integer,
    case when v_status = 'authorized' then v_ev end, case when v_status = 'captured' then v_ev end, case when v_status = 'failed' then v_ev end, v_ev,
    case when nullif(p ->> 'createdMs', '') is null then null else to_timestamp((p ->> 'createdMs')::numeric / 1000.0) end
  )
  on conflict (rzp_payment_id) do update set
    status = case when public.dpdp__ledger_rank(excluded.status) >= public.dpdp__ledger_rank(t.status) then excluded.status else t.status end,
    attempt_id = coalesce(t.attempt_id, excluded.attempt_id),
    txn_id = coalesce(t.txn_id, excluded.txn_id),
    rzp_order_id = coalesce(t.rzp_order_id, excluded.rzp_order_id),
    currency = coalesce(excluded.currency, t.currency),
    amount_paise = coalesce(excluded.amount_paise, t.amount_paise),
    method = coalesce(excluded.method, t.method),
    bank = coalesce(excluded.bank, t.bank),
    wallet = coalesce(excluded.wallet, t.wallet),
    card_network = coalesce(excluded.card_network, t.card_network),
    card_type = coalesce(excluded.card_type, t.card_type),
    card_last4 = coalesce(excluded.card_last4, t.card_last4),
    card_issuer = coalesce(excluded.card_issuer, t.card_issuer),
    vpa_masked = coalesce(excluded.vpa_masked, t.vpa_masked),
    rrn = coalesce(excluded.rrn, t.rrn),
    auth_code = coalesce(excluded.auth_code, t.auth_code),
    is_international = coalesce(excluded.is_international, t.is_international),
    error_code = coalesce(t.error_code, excluded.error_code),
    error_description = coalesce(t.error_description, excluded.error_description),
    error_source = coalesce(t.error_source, excluded.error_source),
    error_step = coalesce(t.error_step, excluded.error_step),
    error_reason = coalesce(t.error_reason, excluded.error_reason),
    fee_paise = coalesce(excluded.fee_paise, t.fee_paise),
    tax_paise = coalesce(excluded.tax_paise, t.tax_paise),
    authorized_at = coalesce(t.authorized_at, excluded.authorized_at),
    captured_at = coalesce(t.captured_at, excluded.captured_at),
    failed_at = coalesce(t.failed_at, excluded.failed_at),
    event_at = greatest(coalesce(t.event_at, excluded.event_at), coalesce(excluded.event_at, t.event_at)),
    rzp_created_at = coalesce(t.rzp_created_at, excluded.rzp_created_at),
    updated_at = now();

  -- A refund that arrived before its payment now learns which website payment it belongs to.
  update dpdp.ledger_refund r
  set attempt_id = coalesce(r.attempt_id, (select x.attempt_id from dpdp.ledger_payment_attempt x where x.rzp_payment_id = v_id)),
      txn_id = coalesce(r.txn_id, (select x.txn_id from dpdp.ledger_payment_attempt x where x.rzp_payment_id = v_id))
  where r.rzp_payment_id = v_id and r.attempt_id is null;

  return jsonb_build_object('ok', true, 'txnId', (select x.txn_id from dpdp.ledger_payment_attempt x where x.rzp_payment_id = v_id), 'status', (select x.status from dpdp.ledger_payment_attempt x where x.rzp_payment_id = v_id));
end
$$;

-- One Razorpay refund. The same refund seen twice is one row; pending moves to processed / failed once and then stays.
create or replace function public.dpdp_ledger_record_refund(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text := nullif(trim(coalesce(p ->> 'rzpRefundId', '')), '');
  v_pay text := nullif(trim(coalesce(p ->> 'rzpPaymentId', '')), '');
  v_status text := coalesce(p ->> 'status', 'pending');
  v_att text;
  v_txn text;
begin
  if v_id is null or v_pay is null then
    raise exception 'A refund id and a payment id are required' using errcode = '22023';
  end if;
  if v_status not in ('pending', 'processed', 'failed') then
    raise exception 'status must be pending, processed or failed' using errcode = '22023';
  end if;
  select x.attempt_id, x.txn_id into v_att, v_txn from dpdp.ledger_payment_attempt x where x.rzp_payment_id = v_pay;

  insert into dpdp.ledger_refund as t (rzp_refund_id, rzp_payment_id, attempt_id, txn_id, currency, amount_paise, status, created_at_rzp)
  values (v_id, v_pay, v_att, v_txn, upper(nullif(p ->> 'currency', '')), greatest(coalesce(nullif(p ->> 'amountPaise', '')::integer, 0), 0), v_status,
    case when nullif(p ->> 'createdMs', '') is null then null else to_timestamp((p ->> 'createdMs')::numeric / 1000.0) end)
  on conflict (rzp_refund_id) do update set
    status = case when t.status = 'pending' then excluded.status else t.status end,
    attempt_id = coalesce(t.attempt_id, excluded.attempt_id),
    txn_id = coalesce(t.txn_id, excluded.txn_id),
    updated_at = now();
  return jsonb_build_object('ok', true, 'txnId', v_txn);
end
$$;

-- The repeat-delivery guard. Seen is marked only AFTER everything for the message succeeded, so a message that failed half way is processed again on Razorpay's retry.
create or replace function public.dpdp_ledger_event_seen(p_event_id text)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from dpdp.ledger_event_seen e where e.rzp_event_id = left(coalesce(p_event_id, ''), 80)) $$;

create or replace function public.dpdp_ledger_mark_event(p_event_id text, p_event text default null)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_event_id is null or trim(p_event_id) = '' then
    return false;
  end if;
  insert into dpdp.ledger_event_seen (rzp_event_id, event) values (left(p_event_id, 80), left(p_event, 60)) on conflict (rzp_event_id) do nothing;
  return true;
end
$$;

-- ---------------------------------------------------------------------
-- 3. The figures of one Indian month (the shape of the central POST /api/pay/site-summary)
-- ---------------------------------------------------------------------
-- What counts: a sale is a dpdp.payment that has a Razorpay payment id and is not a test-mode payment (a bank-transfer "I have paid" never counts). Revenue is dated at
-- dpdp.payment.confirmed_at (when this website booked it); fee and GST are Razorpay's, from the captured attempt. Failed = attempts whose final status is failed (a
-- failed try that was later captured is a sale, not a failure). Refunds = not-failed refunds. Commission: pending ones by creation month = accrued, paid ones by paid month.
create or replace function public.dpdp__ledger_month(p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_y integer;
  v_m integer;
  v_from timestamptz;
  v_to timestamptz;
  v_sales jsonb;
  v_failed bigint;
  v_refunded bigint;
  v_acc bigint;
  v_paid bigint;
begin
  if p_key is null or p_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'month must be YYYY-MM' using errcode = '22023';
  end if;
  v_y := substr(p_key, 1, 4)::integer;
  v_m := substr(p_key, 6, 2)::integer;
  v_from := make_timestamptz(v_y, v_m, 1, 0, 0, 0, 'Asia/Kolkata');
  v_to := make_timestamptz(case when v_m = 12 then v_y + 1 else v_y end, case when v_m = 12 then 1 else v_m + 1 end, 1, 0, 0, 0, 'Asia/Kolkata');

  select jsonb_build_object('paid_count', count(*), 'revenue_minor', coalesce(sum(p.amount_paise), 0), 'fee_minor', coalesce(sum(a.fee_paise), 0), 'tax_minor', coalesce(sum(a.tax_paise), 0))
  into v_sales
  from dpdp.payment p
  left join dpdp.ledger_payment_attempt a on a.rzp_payment_id = p.razorpay_payment_id
  where p.razorpay_payment_id is not null and not coalesce(p.is_test, false)
    and (p.confirmed_at at time zone 'UTC') >= v_from and (p.confirmed_at at time zone 'UTC') < v_to;

  select count(*) into v_failed from dpdp.ledger_payment_attempt a where a.status = 'failed' and a.failed_at >= v_from and a.failed_at < v_to;

  select coalesce(sum(r.amount_paise), 0) into v_refunded
  from dpdp.ledger_refund r
  where r.status <> 'failed' and coalesce(r.created_at_rzp, r.first_seen_at) >= v_from and coalesce(r.created_at_rzp, r.first_seen_at) < v_to
    and not exists (select 1 from dpdp.payment p where p.razorpay_payment_id = r.rzp_payment_id and coalesce(p.is_test, false));

  select coalesce(sum(c.amount_paise) filter (where c.payout_status = 'pending' and (c.created_at at time zone 'UTC') >= v_from and (c.created_at at time zone 'UTC') < v_to), 0),
         coalesce(sum(c.amount_paise) filter (where c.payout_status = 'paid' and (c.paid_at at time zone 'UTC') >= v_from and (c.paid_at at time zone 'UTC') < v_to), 0)
  into v_acc, v_paid
  from dpdp.referral_commission c
  join dpdp.payment p on p.id = c.payment_id
  where p.razorpay_payment_id is not null and not coalesce(p.is_test, false);

  return jsonb_build_object('period_key', p_key, 'currency', 'INR') || v_sales
    || jsonb_build_object('failed_count', v_failed, 'refunded_minor', v_refunded, 'commission_accrued_minor', v_acc, 'commission_paid_minor', v_paid);
end
$$;

-- Current and previous Indian month, for the push to the central ledger.
create or replace function public.dpdp_ledger_month_figures(p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ist timestamp := coalesce(p_now, now()) at time zone 'Asia/Kolkata';
begin
  -- The previous month is taken from the FIRST of the current month, so the 31st never lands on a month with 30 days.
  return jsonb_build_array(
    public.dpdp__ledger_month(to_char(v_ist, 'YYYY-MM')),
    public.dpdp__ledger_month(to_char(date_trunc('month', v_ist) - interval '1 month', 'YYYY-MM'))
  );
end
$$;

-- The "at most every 30 minutes" rule, taken in one locked step so two overlapping runs cannot both push. A try that did not finish is repeated after 5 minutes.
create or replace function public.dpdp_ledger_summary_claim(p_force boolean default false)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_push timestamptz;
  v_try timestamptz;
begin
  insert into dpdp.ledger_state (k, at) values ('last_push', 'epoch'), ('last_try', 'epoch') on conflict (k) do nothing;
  select s.at into v_push from dpdp.ledger_state s where s.k = 'last_push' for update;
  select s.at into v_try from dpdp.ledger_state s where s.k = 'last_try' for update;
  if not coalesce(p_force, false) and (clock_timestamp() - v_push < interval '30 minutes' or clock_timestamp() - v_try < interval '5 minutes') then
    return false;
  end if;
  update dpdp.ledger_state set at = clock_timestamp() where k = 'last_try';
  return true;
end
$$;

create or replace function public.dpdp_ledger_summary_done()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into dpdp.ledger_state (k, at) values ('last_push', clock_timestamp()) on conflict (k) do update set at = excluded.at;
  return true;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Commission (C -> B)
-- ---------------------------------------------------------------------
-- DPDP's commission is dpdp.referral_commission (pending -> paid). It goes to the central ledger as accrued -> paid. Only commissions on a REAL Razorpay sale are listed:
-- a test-mode payment, or a payment booked by bank transfer, is never sent. A row is listed again only when its state differs from what was last told (or when
-- the last try failed and the retry time has passed).
create or replace function public.dpdp_ledger_commissions_to_post(p_limit integer default 5, p_retry_seconds integer default 600)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(q.x order by q.ord1, q.ord2, q.ord3), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', c.id,
        'rzpPaymentId', p.razorpay_payment_id,
        'status', case c.payout_status when 'paid' then 'paid' else 'accrued' end,
        'amountPaise', c.amount_paise,
        'partnerCode', coalesce((select oc.code from dpdp.partner_offer_code oc where oc.partner_identity_id = c.referrer_identity_id and oc.active order by oc.created_at limit 1), c.referrer_identity_id),
        'partnerName', (select sp.display_name from dpdp.sales_partner sp where sp.identity_id = c.referrer_identity_id),
        'paidRef', case when c.payout_status = 'paid' then coalesce(nullif(trim(po.reference), ''), nullif(trim(c.paid_note), ''), 'dpdp-commission-' || c.id) end
      ) as x,
      coalesce(s.try_at, 'epoch'::timestamptz) as ord1, c.created_at as ord2, c.id as ord3
    from dpdp.referral_commission c
    join dpdp.payment p on p.id = c.payment_id
    left join dpdp.partner_payout po on po.id = c.payout_id
    left join dpdp.ledger_commission_sync s on s.commission_id = c.id
    where p.razorpay_payment_id is not null and not coalesce(p.is_test, false) and c.amount_paise > 0
      and s.sync_status is distinct from (case c.payout_status when 'paid' then 'paid' else 'accrued' end)
      and (s.try_at is null or s.try_at <= clock_timestamp() - make_interval(secs => greatest(coalesce(p_retry_seconds, 600), 0)))
    order by coalesce(s.try_at, 'epoch'::timestamptz), c.created_at, c.id
    limit least(greatest(coalesce(p_limit, 5), 1), 25)
  ) q
$$;

create or replace function public.dpdp_ledger_commission_mark(p_commission_id text, p_status text, p_ok boolean, p_error text default null)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_commission_id is null or p_status not in ('accrued', 'paid') then
    raise exception 'a commission id and a status (accrued or paid) are required' using errcode = '22023';
  end if;
  insert into dpdp.ledger_commission_sync as t (commission_id, sync_status, synced_at, try_at, error)
  values (p_commission_id, case when p_ok then p_status end, case when p_ok then clock_timestamp() end, case when p_ok then null else clock_timestamp() end, case when p_ok then null else left(p_error, 200) end)
  on conflict (commission_id) do update set
    sync_status = case when p_ok then p_status else t.sync_status end,
    synced_at = case when p_ok then clock_timestamp() else t.synced_at end,
    try_at = case when p_ok then null else clock_timestamp() end,
    error = case when p_ok then null else left(p_error, 200) end;
  return true;
end
$$;

-- ---------------------------------------------------------------------
-- 5. The owner's report (platform owner only; NO payer e-mail, name or phone anywhere in it: the organisation's name only)
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_ledger(p_month text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_key text := coalesce(p_month, to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM'));
  v_y integer;
  v_m integer;
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb;
begin
  if not public.dpdp__is_platform_admin() then
    perform public.dpdp__require_platform_admin(); -- raises 'Owner only' (42501)
    raise exception 'Owner only' using errcode = '42501';
  end if;
  if v_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'month must be YYYY-MM' using errcode = '22023';
  end if;
  v_y := substr(v_key, 1, 4)::integer;
  v_m := substr(v_key, 6, 2)::integer;
  v_from := make_timestamptz(v_y, v_m, 1, 0, 0, 0, 'Asia/Kolkata');
  v_to := make_timestamptz(case when v_m = 12 then v_y + 1 else v_y end, case when v_m = 12 then 1 else v_m + 1 end, 1, 0, 0, 0, 'Asia/Kolkata');

  select jsonb_build_object(
    'site', 'veridian-aios.com',
    'month', v_key,
    'summary', public.dpdp__ledger_month(v_key),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'txnId', a.txn_id, 'attemptId', a.id, 'orgId', a.org_id, 'organisation', o.name, 'product', a.product, 'variation', a.variation, 'plan', a.plan, 'interval', a."interval",
        'amountPaise', a.amount_paise, 'currency', a.currency, 'status', a.status, 'rzpOrderId', a.razorpay_order_id, 'receipt', a.receipt, 'rzpPaymentId', a.razorpay_payment_id, 'method', a.method,
        'createdUtc', to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'paidUtc', to_char(a.paid_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'dpdpPaymentId', a.payment_id, 'isTest', coalesce(p.is_test, false),
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'rzpPaymentId', x.rzp_payment_id, 'status', x.status, 'amountPaise', x.amount_paise, 'currency', x.currency, 'method', x.method, 'bank', x.bank, 'wallet', x.wallet,
            'cardNetwork', x.card_network, 'cardType', x.card_type, 'cardLast4', x.card_last4, 'vpaMasked', x.vpa_masked, 'rrn', x.rrn, 'international', x.is_international,
            'errorCode', x.error_code, 'errorDescription', x.error_description, 'errorSource', x.error_source, 'errorStep', x.error_step, 'errorReason', x.error_reason,
            'feePaise', x.fee_paise, 'taxPaise', x.tax_paise,
            'authorizedUtc', to_char(x.authorized_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'capturedUtc', to_char(x.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'failedUtc', to_char(x.failed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ) order by coalesce(x.event_at, x.first_seen_at), x.rzp_payment_id)
          from dpdp.ledger_payment_attempt x where x.attempt_id = a.id), '[]'::jsonb),
        'capturedAttempts', (select count(*) from dpdp.ledger_payment_attempt x where x.attempt_id = a.id and x.status = 'captured')
      ) order by a.created_at, a.id)
      from (select * from dpdp.payment_attempt w
            where ((w.created_at at time zone 'UTC') >= v_from and (w.created_at at time zone 'UTC') < v_to) or ((w.paid_at at time zone 'UTC') >= v_from and (w.paid_at at time zone 'UTC') < v_to)
            order by w.created_at, w.id limit 5000) a
      left join dpdp.organisation o on o.id = a.org_id
      left join dpdp.payment p on p.id = a.payment_id
    ), '[]'::jsonb),
    'unmatchedAttempts', coalesce((
      select jsonb_agg(jsonb_build_object('rzpPaymentId', x.rzp_payment_id, 'rzpOrderId', x.rzp_order_id, 'status', x.status, 'amountPaise', x.amount_paise, 'currency', x.currency,
        'method', x.method, 'errorCode', x.error_code, 'seenUtc', to_char(x.first_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by x.first_seen_at)
      from dpdp.ledger_payment_attempt x where x.attempt_id is null and x.first_seen_at >= v_from and x.first_seen_at < v_to), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object('rzpRefundId', r.rzp_refund_id, 'rzpPaymentId', r.rzp_payment_id, 'txnId', r.txn_id, 'currency', r.currency, 'amountPaise', r.amount_paise, 'status', r.status,
        'createdUtc', to_char(coalesce(r.created_at_rzp, r.first_seen_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by coalesce(r.created_at_rzp, r.first_seen_at), r.rzp_refund_id)
      from dpdp.ledger_refund r where coalesce(r.created_at_rzp, r.first_seen_at) >= v_from and coalesce(r.created_at_rzp, r.first_seen_at) < v_to), '[]'::jsonb),
    'commission', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'siteRef', c.id, 'paymentId', c.payment_id, 'rzpPaymentId', p.razorpay_payment_id, 'txnId', (select x.txn_id from dpdp.ledger_payment_attempt x where x.rzp_payment_id = p.razorpay_payment_id),
        'basis', c.basis, 'rate', c.rate, 'amountPaise', c.amount_paise, 'status', c.payout_status, 'isTest', coalesce(p.is_test, false),
        'createdUtc', to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'paidUtc', to_char(c.paid_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'syncStatus', s.sync_status, 'syncedUtc', to_char(s.synced_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'syncError', s.error) order by c.created_at, c.id)
      from dpdp.referral_commission c
      join dpdp.payment p on p.id = c.payment_id
      left join dpdp.ledger_commission_sync s on s.commission_id = c.id
      where ((c.created_at at time zone 'UTC') >= v_from and (c.created_at at time zone 'UTC') < v_to) or ((c.paid_at at time zone 'UTC') >= v_from and (c.paid_at at time zone 'UTC') < v_to)), '[]'::jsonb),
    -- Things a human must look at. An empty list is the goal.
    'issues', coalesce((
      select jsonb_agg(i.j) from (
        select jsonb_build_object('kind', 'paid_twice_for_one_site_payment', 'txnId', x.txn_id, 'count', count(*)) as j
        from dpdp.ledger_payment_attempt x where x.status = 'captured' and x.txn_id is not null group by x.txn_id having count(*) > 1
        union all
        select jsonb_build_object('kind', 'captured_but_not_booked', 'txnId', x.txn_id, 'rzpPaymentId', x.rzp_payment_id, 'attemptStatus', a.status)
        from dpdp.ledger_payment_attempt x join dpdp.payment_attempt a on a.id = x.attempt_id where x.status = 'captured' and a.status <> 'paid'
        union all
        select jsonb_build_object('kind', 'captured_without_a_website_payment', 'rzpPaymentId', x.rzp_payment_id, 'rzpOrderId', x.rzp_order_id)
        from dpdp.ledger_payment_attempt x where x.status = 'captured' and x.attempt_id is null
        union all
        select jsonb_build_object('kind', 'amount_differs', 'txnId', x.txn_id, 'razorpayPaise', x.amount_paise, 'websitePaise', a.amount_paise)
        from dpdp.ledger_payment_attempt x join dpdp.payment_attempt a on a.id = x.attempt_id where x.status = 'captured' and x.amount_paise is distinct from a.amount_paise
      ) i), '[]'::jsonb)
  ) into v_out;

  -- Needs the refund table in the same query level as nothing else: kept separate to stay readable.
  v_out := v_out || jsonb_build_object('issues', (v_out -> 'issues') || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'commission_on_refunded_sale', 'commissionId', c.id, 'rzpPaymentId', p.razorpay_payment_id, 'commissionStatus', c.payout_status))
    from dpdp.referral_commission c
    join dpdp.payment p on p.id = c.payment_id
    where p.razorpay_payment_id is not null
      and (select coalesce(sum(r.amount_paise), 0) from dpdp.ledger_refund r where r.rzp_payment_id = p.razorpay_payment_id and r.status = 'processed') >= p.amount_paise
  ), '[]'::jsonb));
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Who may call what
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__ledger_rank(text) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_record_attempt(jsonb) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_record_refund(jsonb) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_event_seen(text) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_mark_event(text, text) from public, anon, authenticated;
revoke all on function public.dpdp__ledger_month(text) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_month_figures(timestamptz) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_summary_claim(boolean) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_summary_done() from public, anon, authenticated;
revoke all on function public.dpdp_ledger_commissions_to_post(integer, integer) from public, anon, authenticated;
revoke all on function public.dpdp_ledger_commission_mark(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.dpdp_owner_ledger(text) from public, anon;
grant execute on function public.dpdp__ledger_rank(text) to service_role;
grant execute on function public.dpdp_ledger_record_attempt(jsonb) to service_role;
grant execute on function public.dpdp_ledger_record_refund(jsonb) to service_role;
grant execute on function public.dpdp_ledger_event_seen(text) to service_role;
grant execute on function public.dpdp_ledger_mark_event(text, text) to service_role;
grant execute on function public.dpdp__ledger_month(text) to service_role;
grant execute on function public.dpdp_ledger_month_figures(timestamptz) to service_role;
grant execute on function public.dpdp_ledger_summary_claim(boolean) to service_role;
grant execute on function public.dpdp_ledger_summary_done() to service_role;
grant execute on function public.dpdp_ledger_commissions_to_post(integer, integer) to service_role;
grant execute on function public.dpdp_ledger_commission_mark(text, text, boolean, text) to service_role;
grant execute on function public.dpdp_owner_ledger(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. The 30-minute tick: commission changes and the monthly figures go to the central ledger even when no payment event arrives.
-- ---------------------------------------------------------------------
-- Same Vault secrets as the other DPDP jobs; the function checks the bearer with dpdp_timer_check_bearer. cron.schedule upserts by name.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-ledger-tick',
      '*/30 * * * *',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-pay/ledger-tick'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"ledger_tick"}'::jsonb,
          timeout_milliseconds := 60000
        )
      $cron$
    );
  end if;
end
$$;
