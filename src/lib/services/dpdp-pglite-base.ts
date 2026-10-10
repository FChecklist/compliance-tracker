/// <reference types="bun-types" />
// Shared stand-in base for the DPDP account / billing / test-mode PGlite tests: the stand-in tables and the older functions the migrations 0734 and
// 0735 build on (copied out of their own migration files at run time, so a change to them is seen by every test using this base).
import { readFileSync } from 'node:fs'

const REPO_ROOT = new URL('../../../', import.meta.url)
export const read = (rel: string) => readFileSync(new URL(rel, REPO_ROOT), 'utf8').replace(/\r\n/g, '\n')
export function fnFrom(file: string, name: string): string {
  const all = read(file).match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'g'))
  if (!all || all.length === 0) throw new Error(`${file}: function ${name} not found`)
  return all[all.length - 1]
}

export const BASE_SQL = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role app_runtime nologin;
create schema dpdp; create schema auth;
create function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create type dpdp.referral_outcome as enum ('signed_up', 'chose_band', 'free_only', 'blocked');
create type dpdp.membership_level as enum ('owner', 'staff');
create type dpdp.membership_state as enum ('active', 'revoked');
create type dpdp.joined_via as enum ('created', 'named_in_role', 'invited');
create table dpdp.identity (id text primary key, primary_email text unique not null, created_at timestamp not null default now());
create table dpdp.identity_email (id text primary key, identity_id text not null references dpdp.identity (id), email text not null, is_primary boolean not null default false);
create table dpdp.organisation (id text primary key, name text not null, slug text unique not null, product text, created_at timestamp not null default now());
create table dpdp.membership (
  id text primary key, identity_id text not null references dpdp.identity (id), org_id text not null references dpdp.organisation (id),
  level dpdp.membership_level not null, can_sign boolean not null default false, state dpdp.membership_state not null default 'active',
  joined_via dpdp.joined_via not null, created_at timestamp not null default now(), revoked_at timestamp, first_visit_seen_at timestamp, said_not_me_at timestamp, unique (identity_id, org_id)
);
create table dpdp.subscription (
  org_id text primary key references dpdp.organisation (id), band_key text, seats_used integer not null default 0, trial_ends_at timestamp,
  state text not null default 'trial', "interval" text, self_declared_at timestamp, last_confirmed_at timestamp,
  self_declared_interval text, self_declared_amount_paise integer, self_declared_reference text, self_declared_proof_path text, self_declared_note text
);
create table dpdp.referral (identity_id text primary key references dpdp.identity (id), code text not null unique, consented_at timestamp, state text not null default 'active');
create table dpdp.referral_event (
  id text primary key, referral_id text not null references dpdp.referral (identity_id), referred_org_id text not null references dpdp.organisation (id),
  at timestamp not null default now(), outcome dpdp.referral_outcome not null, block_reason text, credit_months integer not null default 0
);
create table dpdp.payment (
  id text primary key, org_id text not null references dpdp.organisation (id), plan text not null check (plan in ('firm', 'institution')),
  "interval" text not null check ("interval" in ('month', 'year')), amount_paise integer not null check (amount_paise > 0),
  period_start date not null default current_date, confirmed_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  confirmed_note text, created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create table dpdp.referral_commission (
  id text primary key, referral_event_id text not null references dpdp.referral_event (id), payment_id text not null references dpdp.payment (id),
  referrer_identity_id text not null references dpdp.identity (id), rate numeric(5, 4) not null, amount_paise integer not null check (amount_paise >= 0),
  basis text not null check (basis in ('first_month', 'yearly')), payout_status text not null default 'pending' check (payout_status in ('pending', 'paid')),
  paid_at timestamp, paid_note text, created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create table dpdp.event (
  id text primary key, org_id text not null, actor_identity_id text, actor_label text not null, kind text not null, summary text not null, detail text,
  route text, device text, occurred_at timestamp not null default now(), prev_hash text, hash text not null, sealed_in_batch text
);
create table dpdp.platform_admin (email text primary key, added_at timestamp not null default (clock_timestamp() at time zone 'UTC'), note text);
create table dpdp.sales_partner (identity_id text primary key references dpdp.identity (id), status text not null default 'applied');
create table dpdp.partner_notice (
  id text primary key default replace(gen_random_uuid()::text, '-', ''), identity_id text not null references dpdp.identity (id), kind text not null,
  dedupe_key text not null, payload jsonb not null default '{}'::jsonb, created_at timestamp not null default now(), unique (identity_id, kind, dedupe_key)
);
create table dpdp.partner_event (id text primary key default replace(gen_random_uuid()::text, '-', ''), identity_id text, kind text not null, summary text not null, detail text, at timestamp not null default now());
create table dpdp.email_preference (membership_id text primary key, unsubscribed_at timestamptz, statutory_only boolean not null default false, updated_at timestamptz not null default now());
create table dpdp.audit_org_policy (org_id text primary key, hod_identity_ids text[] not null default '{}');
create table dpdp.ai_link (id text primary key, token_hash text unique, membership_id text, org_id text, revoked_at timestamp, expires_at timestamp not null);
create table dpdp.obligation_template (id text primary key, name text not null);
create table dpdp.obligation (id text primary key, org_id text not null, template_id text not null, state text not null default 'open', due_on date not null, na_reason text, closed_at timestamp);
create table dpdp.breach (id text primary key, org_id text not null, became_aware_at timestamp not null default now(), deadline_at timestamp not null, state text not null default 'open', description text);
create table dpdp.grievance (id text primary key, org_id text not null, ref text not null unique, summary text not null, state text not null default 'open', officer_decision text);
create table public.t_my_org_calls (ref text, at timestamptz default now());
create table public.t_core_client_calls (name text);
${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_identity_id')}
${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_membership')}
${fnFrom('drizzle/0605_dpdp_wo011_step3_owner_rpc.sql', 'dpdp__append_event')}
${fnFrom('drizzle/0655_dpdp_wo016_refer_and_earn.sql', 'dpdp_record_confirmed_payment')}
${fnFrom('drizzle/0658_dpdp_payment_confirmation_flow.sql', 'dpdp__is_platform_admin')}
${fnFrom('drizzle/0658_dpdp_payment_confirmation_flow.sql', 'dpdp__require_platform_admin')}
${fnFrom('drizzle/0674_dpdp_sales_partner_lifecycle.sql', 'dpdp__partner_notify')}

-- stand-ins for functions that already exist live; the migration under test wraps or replaces them
create function dpdp.unsubscribe(p_token text) returns jsonb language sql as $f$ select jsonb_build_object('ok', false, 'reason', 'old path') $f$;
create function public.dpdp_create_my_org(p_name text, p_product text, p_referral_code text default null) returns jsonb language plpgsql security definer set search_path = '' as $f$
declare v_email text := lower(auth.jwt() ->> 'email'); v_identity text; v_org text := replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.t_my_org_calls (ref) values (p_referral_code);
  select ie.identity_id into v_identity from dpdp.identity_email ie where ie.email = v_email;
  if v_identity is null then
    v_identity := 'i_' || v_org;
    insert into dpdp.identity (id, primary_email) values (v_identity, v_email);
    insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_' || v_org, v_identity, v_email, true);
  end if;
  insert into dpdp.organisation (id, name, slug, product) values (v_org, p_name, v_org, p_product);
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_' || v_org, v_identity, v_org, 'owner', 'created');
  insert into dpdp.subscription (org_id, trial_ends_at, state) values (v_org, (clock_timestamp() at time zone 'UTC') + interval '30 days', 'trial');
  return jsonb_build_object('ok', true, 'orgId', v_org, 'slug', v_org, 'membershipId', 'm_' || v_org, 'jobs', 0, 'existing', false);
end $f$;
create function public.dpdp_create_client_org(p_name text, p_product text, p_owner_email text default null) returns jsonb language plpgsql security definer set search_path = '' as $f$
declare v_identity text := public.dpdp__caller_identity_id(); v_org text := replace(gen_random_uuid()::text, '-', '');
begin
  if v_identity is null then raise exception 'Not a member of this organisation' using errcode = '42501'; end if;
  insert into public.t_core_client_calls (name) values (p_name);
  insert into dpdp.organisation (id, name, slug, product) values (v_org, p_name, v_org, p_product);
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_' || v_org, v_identity, v_org, 'staff', 'created');
  return jsonb_build_object('ok', true, 'orgId', v_org, 'slug', v_org, 'jobs', 0, 'ownerMembershipId', null);
end $f$;
create function public.dpdp_my_billing(p_org_id text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $f$
declare m dpdp.membership; begin m := public.dpdp__caller_membership(p_org_id); return jsonb_build_object('orgId', m.org_id); end $f$;
create function public.dpdp_declare_payment(p_interval text, p_amount_paise integer, p_org_id text default null, p_reference text default null, p_proof_path text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare m dpdp.membership; begin m := public.dpdp__caller_membership(p_org_id); return jsonb_build_object('ok', true, 'orgId', m.org_id); end $f$;
create function public.dpdp_pay_begin(p_interval text, p_org_id text default null) returns jsonb language plpgsql security definer set search_path = '' as $f$
declare m dpdp.membership; begin m := public.dpdp__caller_membership(p_org_id); return jsonb_build_object('orgId', m.org_id); end $f$;
-- a stand-in for any WORKING screen: it uses the gated door like every real one
create function public.t_work(p_org_id text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $f$
declare m dpdp.membership; begin m := public.dpdp__caller_membership(p_org_id); if m.id is null then raise exception 'Not a member of this organisation' using errcode = '42501'; end if; return jsonb_build_object('org', m.org_id); end $f$;
`