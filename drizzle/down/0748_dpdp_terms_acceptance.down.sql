-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-13 -- rollback of 0748 (ticked Terms boxes); run only if 0748 must be undone, after review.
-- Rollback of drizzle/0748_dpdp_terms_acceptance.sql. NOT applied by anyone automatically.
-- WARNING: this drops dpdp.terms_acceptance with every recorded tick. Take a copy first if any sign-up or payment has been made since 0748.
-- It puts the three original functions back under their original names and grants.
begin;

drop function if exists public.dpdp_pay_begin(text, text, text, boolean);
drop function if exists public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text, text, boolean);
drop function if exists public.dpdp_create_my_org(text, text, text, text, boolean);

do $$
begin
  if to_regprocedure('public.dpdp__open_account_core(text, text, text, text, text, text, text, timestamptz, text)') is not null then
    alter function public.dpdp__open_account_core(text, text, text, text, text, text, text, timestamptz, text) rename to dpdp_open_account;
  end if;
  if to_regprocedure('public.dpdp__create_my_org_core(text, text, text)') is not null then
    alter function public.dpdp__create_my_org_core(text, text, text) rename to dpdp_create_my_org;
  end if;
end
$$;

-- the always-open pay wrapper from 0734, unchanged
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

revoke all on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text) from public, anon;
revoke all on function public.dpdp_create_my_org(text, text, text) from public, anon;
revoke all on function public.dpdp_pay_begin(text, text) from public, anon;
grant execute on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text) to authenticated, app_runtime;
grant execute on function public.dpdp_create_my_org(text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_pay_begin(text, text) to authenticated, app_runtime;

drop table if exists dpdp.terms_acceptance;
drop function if exists dpdp.terms_record(text, text, text, text, text);
drop function if exists dpdp.terms_require(text, text, boolean);
drop function if exists dpdp.terms_box_text(text);
drop function if exists dpdp.terms_current_version();
drop function if exists dpdp.terms_acceptance_never_edited();

commit;
