-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved the new DPDP pricing in chat on 2026-11-02; this is the rollback of 0755 (Rs 99 trial pack, Rs 999 a month, per-client price). Run only if 0755 must be undone, after review.
--
-- WHAT THIS DOES: puts the DATA and the SCHEMA back (the four tiers and the free plan switch back on, the institution price and the ten-month year
-- return, the new columns and helper functions go). It FAILS ON PURPOSE (the constraint re-add) if any payment, attempt or subscription row already
-- carries the interval 'pack': refund or re-label those first.
--
-- WHAT THIS DOES NOT DO: it does not rewrite the functions 0755 replaced. RUN ORDER: FIRST restore them by re-running the function sections of
-- 0734, 0735, 0747 and 0748 (all CREATE OR REPLACE): dpdp.account_on_payment, dpdp_record_confirmed_payment (0655), dpdp__pay_begin_core (0747),
-- dpdp__declare_payment_core, dpdp_owner_mark_paid, dpdp_test_payment, dpdp_my_account, dpdp_public_plans, dpdp_account_choose_plan,
-- dpdp_create_client_org, dpdp_account_save_profile, dpdp_owner_downgrade_firm, dpdp__open_account_core, dpdp_create_my_org (0748),
-- dpdp_plan_price_paise and dpdp_billing_prices (0673: the typed Rs 9,999 / Rs 1,999); THEN run this file.
-- (The functions 0755 wrote call the helpers this file drops, so dropping them first would break paying.)
begin;

-- 1. plans, settings
update dpdp.plan set active = true, updated_at = (clock_timestamp() at time zone 'UTC')
where key in ('firm_free', 'firm_starter', 'firm_growth', 'firm_practice', 'firm_large');
update dpdp.plan set active = false, updated_at = (clock_timestamp() at time zone 'UTC') where key = 'firm';
update dpdp.plan
set name = 'Institution', list_monthly_paise = 80100, offer_monthly_paise = 39900, offer_starts_on = date '2026-10-06', offer_ends_on = null,
    updated_at = (clock_timestamp() at time zone 'UTC')
where key = 'institution' and list_monthly_paise = 99900;
update dpdp.billing_setting set yearly_months_charged = 10, updated_at = (clock_timestamp() at time zone 'UTC') where id = 1 and yearly_months_charged = 6;

-- 2. the interval 'pack' goes (fails if a pack row exists)
alter table dpdp.payment drop constraint if exists payment_interval_check;
alter table dpdp.payment add constraint payment_interval_check check ("interval" in ('month', 'year'));
alter table dpdp.subscription drop constraint if exists subscription_interval_check;
alter table dpdp.subscription add constraint subscription_interval_check check ("interval" in ('month', 'year'));
alter table dpdp.subscription drop constraint if exists subscription_self_declared_interval_check;
alter table dpdp.subscription add constraint subscription_self_declared_interval_check check (self_declared_interval in ('month', 'year'));
do $$
begin
  if to_regclass('dpdp.payment_attempt') is not null then
    alter table dpdp.payment_attempt drop constraint if exists payment_attempt_interval_check;
    alter table dpdp.payment_attempt add constraint payment_attempt_interval_check check ("interval" in ('month', 'year'));
  end if;
end
$$;

-- 3. the new helpers, columns and the plan
drop function if exists dpdp.ensure_account(text, text);
drop function if exists dpdp.account_charge_paise(dpdp.account, text, integer);
drop function if exists dpdp.account_monthly_total_paise(dpdp.account, integer);
drop function if exists dpdp.account_pack_available(dpdp.account);
drop function if exists dpdp.account_client_cap(dpdp.account);
alter table dpdp.account drop column if exists pack_paid_at;
alter table dpdp.billing_setting drop constraint if exists billing_setting_pack;
alter table dpdp.billing_setting drop column if exists pack_price_paise;
alter table dpdp.billing_setting drop column if exists pack_days;
alter table dpdp.billing_setting drop column if exists pack_max_clients;
alter table dpdp.plan drop column if exists included_clients;
alter table dpdp.plan drop column if exists extra_client_monthly_paise;
-- the plan row 'firm' is kept (an account may point at it); delete it by hand once nothing does:
--   delete from dpdp.plan where key = 'firm' and not exists (select 1 from dpdp.account a where a.plan_key = 'firm');

commit;
