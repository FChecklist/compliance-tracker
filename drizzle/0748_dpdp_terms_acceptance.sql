-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-13 -- ticked Terms boxes at sign-up (K2) and before paying (K3), recorded and enforced on the server. Written, NOT applied: the project manager reviews it and applies it.
-- 0748: a ticked box before the commitment, checked by the database itself, and a record of every tick.
--
--   K2  at sign-up (opening the organisation/account):  "I have read and agree to the Terms & Conditions and the Privacy Policy."
--   K3  before paying online:                           "I agree to the Terms and the Refund Policy."
--
-- WHAT THIS ADDS (additive; repeat-safe: every statement can run twice with the same result):
--   dpdp.terms_acceptance        one row per tick: WHO (identity, organisation), KIND (K2/K3), REFERENCE ('signup' or the payment attempt id),
--                                the TERMS VERSION in force, the SHA-256 of the box wording, WHEN. There is deliberately NO column for an IP
--                                address or any device detail. Not exposed to browsers (RLS on, no policy, no grant); read with SQL / the
--                                service role only. A row is never edited (trigger); the same tick is never recorded twice (unique index).
--   dpdp.terms_current_version() the ONE database constant for the version, '2026-10-13'. Changing it (a new migration with a new literal) makes
--                                every client still sending the old version be refused until its box is ticked against the new one.
--   dpdp.terms_box_text(kind)    the agreed wording of each box (the page shows the same words; a test compares them).
--   dpdp.terms_require / terms_record   the check and the write, used by the three entry points below.
--
--   public.dpdp_open_account     gains p_terms_version + p_terms_accepted (both optional, default null/false). The previous 9-argument body is
--                                renamed dpdp__open_account_core (guarded, so a re-run never renames a wrapper) and is no longer callable by a
--                                browser. A call that does not carry the current version AND a true box is REFUSED:
--                                  message 'Please tick the box to continue.'   SQLSTATE 22023   hint 'consent-required'
--   public.dpdp_create_my_org    the same, for a direct call (the 3-argument body becomes dpdp__create_my_org_core). When dpdp_open_account calls
--                                it (it already checked and records the tick itself) a transaction-local flag lets it through.
--   public.dpdp_pay_begin        gains the same two parameters for K3 (the always-open wrapper from 0734 is replaced; the core,
--                                dpdp__pay_begin_core from 0747, is untouched). Old two-argument callers now get the refusal above: that is the
--                                intended fail-closed behaviour -- no payment attempt is opened without the tick.
--   Existing organisations, accounts and payments are NOT touched and are NOT asked retroactively.
--
-- NOT CHANGED: dpdp_declare_payment ("I have paid by bank transfer" records a payment already made elsewhere, it opens no order).
-- AFTER APPLYING: PostgREST reloads its schema cache by itself; apply at a quiet moment (see the PGRST002 note in OPERATIONS.md), then redeploy
-- the dpdp-pay Edge Function (it forwards the two new fields) and ship the app build that shows the boxes.

-- ---------------------------------------------------------------------
-- 1. The record
-- ---------------------------------------------------------------------
create table if not exists dpdp.terms_acceptance (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  identity_id text not null,
  org_id text,
  kind text not null check (kind in ('K2', 'K3')),
  reference text not null check (char_length(reference) between 1 and 100),
  terms_version text not null check (char_length(terms_version) between 1 and 40),
  box_text_hash text not null check (box_text_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
-- No foreign keys on purpose: an acceptance is evidence that outlives an offboarded organisation; it holds only opaque ids.
create unique index if not exists dpdp_terms_acceptance_once_key on dpdp.terms_acceptance (identity_id, kind, reference, (coalesce(org_id, '')));
create index if not exists dpdp_terms_acceptance_org_idx on dpdp.terms_acceptance (org_id, accepted_at);

alter table dpdp.terms_acceptance enable row level security;
revoke all on dpdp.terms_acceptance from public, anon, authenticated;

create or replace function dpdp.terms_acceptance_never_edited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A recorded acceptance cannot be changed' using errcode = '42501';
end
$$;
drop trigger if exists terms_acceptance_never_edited on dpdp.terms_acceptance;
create trigger terms_acceptance_never_edited before update on dpdp.terms_acceptance
  for each row execute function dpdp.terms_acceptance_never_edited();

-- ---------------------------------------------------------------------
-- 2. The version, the wording, the check and the write
-- ---------------------------------------------------------------------
create or replace function dpdp.terms_current_version()
returns text
language sql immutable
set search_path = ''
as $$ select '2026-10-13'::text $$;

create or replace function dpdp.terms_box_text(p_kind text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_kind
    when 'K2' then 'I have read and agree to the Terms & Conditions and the Privacy Policy.'
    when 'K3' then 'I agree to the Terms and the Refund Policy.'
  end
$$;

create or replace function dpdp.terms_require(p_kind text, p_version text, p_accepted boolean)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if dpdp.terms_box_text(p_kind) is null then
    raise exception 'Unknown acceptance kind' using errcode = '22023';
  end if;
  if p_accepted is not true or p_version is distinct from dpdp.terms_current_version() then
    raise exception 'Please tick the box to continue.' using errcode = '22023', hint = 'consent-required';
  end if;
end
$$;

create or replace function dpdp.terms_record(p_kind text, p_identity_id text, p_org_id text, p_reference text, p_version text)
returns void
language plpgsql volatile
set search_path = ''
as $$
begin
  insert into dpdp.terms_acceptance (identity_id, org_id, kind, reference, terms_version, box_text_hash)
  values (p_identity_id, p_org_id, p_kind, p_reference, p_version, encode(sha256(convert_to(dpdp.terms_box_text(p_kind), 'UTF8')), 'hex'))
  on conflict do nothing;
end
$$;

revoke all on function dpdp.terms_acceptance_never_edited() from public, anon, authenticated;
revoke all on function dpdp.terms_current_version() from public, anon, authenticated;
revoke all on function dpdp.terms_box_text(text) from public, anon, authenticated;
revoke all on function dpdp.terms_require(text, text, boolean) from public, anon, authenticated;
revoke all on function dpdp.terms_record(text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The doors. The original bodies become *_core (guarded: a re-run never renames a wrapper); the wrappers check the tick first.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.dpdp__open_account_core(text, text, text, text, text, text, text, timestamptz, text)') is null
     and to_regprocedure('public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text)') is not null then
    alter function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text) rename to dpdp__open_account_core;
  end if;
  if to_regprocedure('public.dpdp__create_my_org_core(text, text, text)') is null
     and to_regprocedure('public.dpdp_create_my_org(text, text, text)') is not null then
    alter function public.dpdp_create_my_org(text, text, text) rename to dpdp__create_my_org_core;
  end if;
  if to_regprocedure('public.dpdp__pay_begin_core(text, text)') is null
     and to_regprocedure('public.dpdp_pay_begin(text, text)') is not null then
    alter function public.dpdp_pay_begin(text, text) rename to dpdp__pay_begin_core;
  end if;
end
$$;

-- The cores are internal: a browser must never reach them (the grants the original functions carried are removed).
revoke all on function public.dpdp__open_account_core(text, text, text, text, text, text, text, timestamptz, text) from public, anon, authenticated, app_runtime;
revoke all on function public.dpdp__create_my_org_core(text, text, text) from public, anon, authenticated, app_runtime;

-- The old two-argument pay wrapper (0734) is replaced by the four-argument one below. A browser calling it by name with two
-- arguments reaches the new function with no tick and is refused; the old signature itself is removed so the name is not ambiguous.
drop function if exists public.dpdp_pay_begin(text, text);

create or replace function public.dpdp_create_my_org(p_name text, p_product text, p_referral_code text default null, p_terms_version text default null, p_terms_accepted boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  -- dpdp_open_account has already checked and will record the tick, and says so with a flag that lives for this transaction only.
  if coalesce(current_setting('dpdp.terms_ok', true), '') = 'on' then
    return public.dpdp__create_my_org_core(p_name, p_product, p_referral_code);
  end if;
  perform dpdp.terms_require('K2', p_terms_version, p_terms_accepted);
  v_res := public.dpdp__create_my_org_core(p_name, p_product, p_referral_code);
  perform dpdp.terms_record('K2', public.dpdp__caller_identity_id(), v_res ->> 'orgId', 'signup', p_terms_version);
  return v_res;
end
$$;

create or replace function public.dpdp_open_account(
  p_account_type text, p_org_name text,
  p_professional_body text default null, p_registration_no text default null,
  p_referral_code text default null, p_partner_code text default null,
  p_source_tag text default null, p_first_seen_at timestamptz default null,
  p_billing_contact_email text default null,
  p_terms_version text default null, p_terms_accepted boolean default false
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  perform dpdp.terms_require('K2', p_terms_version, p_terms_accepted);
  perform set_config('dpdp.terms_ok', 'on', true);
  v_res := public.dpdp__open_account_core(
    p_account_type, p_org_name, p_professional_body, p_registration_no, p_referral_code, p_partner_code, p_source_tag, p_first_seen_at, p_billing_contact_email
  );
  perform set_config('dpdp.terms_ok', '', true);
  perform dpdp.terms_record('K2', public.dpdp__caller_identity_id(), v_res ->> 'orgId', 'signup', p_terms_version);
  return v_res;
end
$$;

create or replace function public.dpdp_pay_begin(p_interval text, p_org_id text default null, p_terms_version text default null, p_terms_accepted boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  perform dpdp.terms_require('K3', p_terms_version, p_terms_accepted);
  perform set_config('dpdp.allow_locked', 'on', true); -- as the 0734 wrapper did: paying works while an account is locked
  v_res := public.dpdp__pay_begin_core(p_interval, p_org_id);
  perform dpdp.terms_record('K3', public.dpdp__caller_identity_id(), v_res ->> 'orgId', v_res ->> 'attemptId', p_terms_version);
  return v_res;
end
$$;

revoke all on function public.dpdp__pay_begin_core(text, text) from public, anon, authenticated;
grant execute on function public.dpdp__pay_begin_core(text, text) to app_runtime;

revoke all on function public.dpdp_create_my_org(text, text, text, text, boolean) from public, anon;
revoke all on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text, text, boolean) from public, anon;
revoke all on function public.dpdp_pay_begin(text, text, text, boolean) from public, anon;
grant execute on function public.dpdp_create_my_org(text, text, text, text, boolean) to authenticated, app_runtime;
grant execute on function public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text, text, boolean) to authenticated, app_runtime;
grant execute on function public.dpdp_pay_begin(text, text, text, boolean) to authenticated, app_runtime;
