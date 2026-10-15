-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved the DPDP account/plan model in chat on 2026-10-06 ("currently yes, build it")
-- Roll-back of drizzle/0734_dpdp_account_opening_plans_billing.sql. NOT applied by anyone automatically.
-- WARNING: this DROPS the account, plan, client-link and commission tables with whatever they hold. Take a copy first if any account has been opened.
-- It puts the five wrapped functions back under their original names and restores the original gate-free versions of the two door functions.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('dpdp-billing-due');
  end if;
exception when others then
  null; -- the job did not exist
end
$$;

-- the unsubscribe page goes back to the weekly-email token only
create or replace function public.dpdp_unsubscribe(p_token text)
returns jsonb
language sql volatile security definer
set search_path = ''
as $$ select dpdp.unsubscribe(p_token) $$;

-- the AI link door without the payment gate (0607's body)
create or replace function public.dpdp__ai_link_for_token(p_token text)
returns dpdp.ai_link
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_l dpdp.ai_link;
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
  return v_l;
end
$$;

-- the working-screen door without the gate (0604's body)
create or replace function public.dpdp__caller_membership(p_org_id text default null)
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

-- the wrapped functions: drop each wrapper, then give the original its name back
drop function if exists public.dpdp_my_billing(text);
alter function public.dpdp__my_billing_core(text) rename to dpdp_my_billing;
drop function if exists public.dpdp_declare_payment(text, integer, text, text, text, text);
alter function public.dpdp__declare_payment_core(text, integer, text, text, text, text) rename to dpdp_declare_payment;
drop function if exists public.dpdp_pay_begin(text, text);
alter function public.dpdp__pay_begin_core(text, text) rename to dpdp_pay_begin;
drop function if exists public.dpdp_create_client_org(text, text, text, text);
alter function public.dpdp__create_client_org_core(text, text, text) rename to dpdp_create_client_org;
grant execute on function public.dpdp_my_billing(text) to authenticated, app_runtime;
grant execute on function public.dpdp_declare_payment(text, integer, text, text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_pay_begin(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_create_client_org(text, text, text) to authenticated, app_runtime;

drop trigger if exists account_on_payment on dpdp.payment;
drop function if exists dpdp.account_on_payment();

drop function if exists public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text);
drop function if exists public.dpdp_my_account(text);
drop function if exists public.dpdp_public_plans();
drop function if exists public.dpdp_account_set_professional(text, text, text);
drop function if exists public.dpdp_account_choose_plan(text, text, text);
drop function if exists public.dpdp_owner_pending_verifications();
drop function if exists public.dpdp_owner_verify_firm(text, text, text);
drop function if exists public.dpdp_owner_mark_paid(text, text, integer, date, text, text);
drop function if exists public.dpdp_owner_update_plan(text, integer, integer, date, date, boolean);
drop function if exists public.dpdp_owner_set_partner_code(text, text, numeric, boolean);
drop function if exists public.dpdp_locked_download(text);
drop function if exists public.dpdp_locked_record_breach(text, text);
drop function if exists public.dpdp_locked_answer_grievance(text, text, text);
drop function if exists public.dpdp_timer_billing_due_line(text);
drop function if exists public.dpdp_billing_due_worklist(timestamptz, integer, boolean);
drop function if exists public.dpdp_billing_notice_mark(text, text, text, text);
drop function if exists public.dpdp_billing_final_download_mark(text);
drop function if exists public.dpdp__offer_label(integer, integer);
drop function if exists public.dpdp__caller_membership_open(text);
drop function if exists dpdp.billing_unsubscribe(text);
drop function if exists dpdp.assert_not_locked(text);
drop function if exists dpdp.org_billing_state(text, timestamp);
drop function if exists dpdp.account_period_end(dpdp.account);
drop function if exists dpdp.account_is_free(dpdp.account);
drop function if exists dpdp.account_for_org(text);
drop function if exists dpdp.billing_due_line(text);
drop function if exists dpdp.charge_paise(integer, text);
drop function if exists dpdp.plan_monthly_paise(text, date, numeric);
drop function if exists dpdp.offer_active(date, date, date);
drop function if exists dpdp.billing_state_calc(boolean, timestamp, timestamp, timestamp, integer, integer, integer);
drop function if exists dpdp.clean_registration(text);

drop table if exists dpdp.billing_notice_sent;
drop table if exists dpdp.billing_notice_token;
drop table if exists dpdp.billing_email_optout;
drop table if exists dpdp.account_commission;
drop table if exists dpdp.account_client;
drop table if exists dpdp.account;
drop table if exists dpdp.partner_offer_code;
drop table if exists dpdp.plan;
drop table if exists dpdp.billing_setting;
