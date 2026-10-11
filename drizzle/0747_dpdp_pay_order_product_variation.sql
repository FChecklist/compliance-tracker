-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat on 2026-10-11 ("use the same method in veridian-aios.com dpdp project for payment, complete it ... make it live"; "ensure that we maintain clear payment at our end internally to trace which payment was for which product and which variation").
-- 0747: DPDP takes money the same way Corporate Tambola does (Razorpay ORDER, window inside the registered IT Services pay frame), and every
-- payment is traceable to a PRODUCT and a VARIATION on our side.
--
--   * dpdp.payment_attempt gains: product ('veridian_dpdp'), variation (the plan the buyer is on + the interval, e.g. professional_year), receipt
--     (the Razorpay receipt, 'dpdp_' + attempt id). The same words are written on the Razorpay order (notes.product, notes.variation, receipt), so
--     a Razorpay export and our database agree row for row. See docs/PAYMENT_TRACING.md and scripts/razorpay-ledger-report.mjs.
--   * dpdp__pay_begin_core (behind dpdp_pay_begin, 0734) now charges the ACCOUNT's own yearly price (locked monthly price x months charged for a
--     year, dpdp.charge_paise) instead of the old flat Rs 9,999, so the online amount equals what the owner is shown. An organisation with no
--     account row keeps the old flat price. A free account, or a client covered by its firm, has nothing to pay and is refused.
--   * dpdp_pay_attempt_order stores the order id + receipt on an open attempt (the Payment Link column stays for old links).
--   * dpdp.payment_ledger: one row per attempt joined to its booked payment. Service role / SQL only; never exposed to the browser.
alter table dpdp.payment_attempt
  add column if not exists product text not null default 'veridian_dpdp',
  add column if not exists variation text,
  add column if not exists receipt text;
update dpdp.payment_attempt set variation = plan || '_' || "interval" where variation is null;
create unique index if not exists dpdp_payment_attempt_receipt_key on dpdp.payment_attempt (receipt) where receipt is not null;

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
  if p_interval is distinct from 'year' then
    raise exception 'Online payment is for the yearly plan' using errcode = '22023';
  end if;
  select * into v_org from dpdp.organisation where id = v_m.org_id;
  if v_org.product is null or v_org.product not in ('firm', 'institution') then
    raise exception 'This organisation has no edition set yet' using errcode = '22023';
  end if;
  -- An account (dpdp.account) charges ITS price; an older organisation without one keeps the flat price.
  v_acc := dpdp.account_for_org(v_m.org_id);
  if v_acc.org_id is not null then
    if v_acc.org_id <> v_m.org_id then
      raise exception 'This organisation is covered by its firm; the firm pays' using errcode = '22023';
    end if;
    if dpdp.account_is_free(v_acc) then
      raise exception 'This account is on the free plan; nothing is due' using errcode = '22023';
    end if;
    v_amount := dpdp.charge_paise(v_acc.locked_monthly_paise, p_interval);
    v_plan_key := v_acc.plan_key;
  else
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
    'Owner opened online payment: Rs ' || to_char(v_amount / 100.0, 'FM999999999.00') || ' (' || p_interval || 'ly)', p_interval);

  return jsonb_build_object(
    'attemptId', v_attempt, 'orgId', v_m.org_id, 'plan', v_org.product, 'variation', v_plan_key || '_' || p_interval, 'orgName', v_org.name, 'interval', p_interval,
    'amountPaise', v_amount, 'currency', 'INR', 'ownerEmail', v_email
  );
end
$$;

create or replace function public.dpdp_pay_attempt_order(p_attempt_id text, p_order_id text, p_receipt text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  update dpdp.payment_attempt
  set razorpay_order_id = p_order_id, receipt = p_receipt
  where id = p_attempt_id and status = 'created';
  if not found then
    raise exception 'No open payment attempt with that id' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.dpdp_pay_attempt_order(text, text, text) from public, anon, authenticated;
grant execute on function public.dpdp_pay_attempt_order(text, text, text) to service_role;

create or replace view dpdp.payment_ledger as
select a.product, a.variation, a.plan, a."interval", a.org_id, o.name as organisation,
       a.id as attempt_id, a.receipt, a.razorpay_order_id, a.razorpay_payment_id, a.method,
       a.amount_paise, a.currency, a.status, a.created_at, a.paid_at, a.payment_id as dpdp_payment_id
from dpdp.payment_attempt a
join dpdp.organisation o on o.id = a.org_id;
revoke all on dpdp.payment_ledger from public, anon, authenticated;
grant select on dpdp.payment_ledger to service_role;
