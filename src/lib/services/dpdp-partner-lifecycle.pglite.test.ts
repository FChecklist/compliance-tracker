/// <reference types="bun-types" />
// DPDP Sales Partner lifecycle (drizzle/0674_dpdp_sales_partner_lifecycle.sql): offline proof on
// PGlite (real Postgres compiled to WASM -- no server, no live database touched).
//
// BASE: stand-ins for the dpdp tables and functions the migration builds on. The function bodies
// that matter (the caller's identity, the hash-chained event writer, find-or-create identity, the
// platform-admin check and the older money functions) are copied out of drizzle/0604, 0605, 0655
// and 0658 at run time, not retyped, so this test cannot drift from them. The table shapes are
// the ones 0415 / 0655 / 0658 create.
//
// WHAT RUNS: the migration is applied twice (idempotent), then scripts/dpdp/partner-lifecycle-scenario.sql
// -- the same behaviour script the live-database run uses -- which makes its own people, organisations,
// payments, commissions and payouts and ends by RAISING its results, so nothing is kept. Each result
// line is PASS, FAIL or SKIP; this test fails on any FAIL. The one SKIP is the real
// dpdp_create_my_org attribution, which needs the live obligation library: that part is proven by
// scripts/dpdp/partner-lifecycle-live-test.mjs against the live project (rolled back).
//
// Run: bun test --isolate src/lib/services/dpdp-partner-lifecycle.pglite.test.ts
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const REPO_ROOT = new URL('../../../', import.meta.url)
const read = (rel: string) => readFileSync(new URL(rel, REPO_ROOT), 'utf8').replace(/\r\n/g, '\n')

/** The whole `create or replace function public.<name>(...) ... $$;` block of a migration file. */
function fnFrom(file: string, name: string, which: 'first' | 'last' = 'last'): string {
  const text = read(file)
  const re = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'g')
  const all = text.match(re)
  if (!all || all.length === 0) throw new Error(`${file}: function ${name} not found`)
  return which === 'first' ? all[0] : all[all.length - 1]
}

const BASE_SQL = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role app_runtime nologin;
create schema dpdp; create schema auth;
create function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;

create type dpdp.referral_outcome as enum ('signed_up', 'chose_band', 'free_only', 'blocked');
create type dpdp.membership_level as enum ('owner', 'staff');
create type dpdp.membership_state as enum ('active', 'revoked');
create type dpdp.joined_via as enum ('created', 'named_in_role', 'invited');

create table dpdp.identity (id text primary key, primary_email text unique not null, created_at timestamp not null default now());
create table dpdp.identity_email (id text primary key, identity_id text not null references dpdp.identity (id), email text not null, is_primary boolean not null default false);
create table dpdp.organisation (id text primary key, name text not null, slug text unique not null, product text not null);
create table dpdp.membership (
  id text primary key, identity_id text not null references dpdp.identity (id), org_id text not null references dpdp.organisation (id),
  level dpdp.membership_level not null, can_sign boolean not null default false, state dpdp.membership_state not null default 'active',
  joined_via dpdp.joined_via not null, created_at timestamp not null default now(), revoked_at timestamp, unique (identity_id, org_id)
);
create table dpdp.subscription (
  org_id text primary key references dpdp.organisation (id), band_key text, seats_used integer not null default 0, trial_ends_at timestamp,
  state text not null default 'trial', "interval" text, self_declared_at timestamp, last_confirmed_at timestamp
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

${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_identity_id')}
${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_membership')}
${fnFrom('drizzle/0605_dpdp_wo011_step3_owner_rpc.sql', 'dpdp__append_event')}
${fnFrom('drizzle/0605_dpdp_wo011_step3_owner_rpc.sql', 'dpdp__find_or_create_identity')}
${fnFrom('drizzle/0658_dpdp_payment_confirmation_flow.sql', 'dpdp__is_platform_admin')}
${fnFrom('drizzle/0655_dpdp_wo016_refer_and_earn.sql', 'dpdp_record_confirmed_payment')}
${fnFrom('drizzle/0655_dpdp_wo016_refer_and_earn.sql', 'dpdp_admin_pending_payouts')}
${fnFrom('drizzle/0655_dpdp_wo016_refer_and_earn.sql', 'dpdp_mark_commission_paid')}
`

const MIGRATION = read('drizzle/0674_dpdp_sales_partner_lifecycle.sql')
const SCENARIO = read('scripts/dpdp/partner-lifecycle-scenario.sql')

/** Runs the scenario on a database that already has the base and the migration; returns its result lines. */
async function runScenario(db: PGlite): Promise<string[]> {
  try {
    await db.exec(SCENARIO)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const i = message.indexOf('RESULT\n')
    if (i === -1) throw e
    return message.slice(i + 'RESULT\n'.length).split('\n').filter((l) => l.trim())
  }
  throw new Error('the scenario must end by raising its results; it finished without raising')
}

describe('drizzle/0674_dpdp_sales_partner_lifecycle.sql on PGlite', () => {
  test('applies cleanly twice, and the scenario passes every check', async () => {
    const db = new PGlite()
    await db.exec(BASE_SQL)
    await db.exec(MIGRATION)
    await db.exec(MIGRATION) // idempotent
    const lines = await runScenario(db)
    if (process.env.DPDP_PARTNER_SCENARIO_LOG) console.log(lines.join('\n'))
    const failed = lines.filter((l) => l.startsWith('FAIL'))
    expect(failed, failed.join('\n')).toEqual([])
    const passed = lines.filter((l) => l.startsWith('PASS'))
    expect(passed.length).toBeGreaterThanOrEqual(80)
    // The only thing this base cannot do is the real sign-up RPC (it needs the live obligation library).
    expect(lines.filter((l) => l.startsWith('SKIP')).length).toBe(1)
    await db.close()
  }, 120_000)

  test('the migration starts with the required DDL-authorization citation', () => {
    expect(MIGRATION.split('\n')[0]).toMatch(/^-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-10-01 -- "COMPLETE THE FULL SALES PARTNER LIFECYCLE, AND SALES LIFECYCLE, INTEGRATE AND GO LIVE"$/)
  })

  test('the older money functions keep their signatures (existing callers are not broken)', () => {
    expect(MIGRATION).toContain('create or replace function public.dpdp_record_confirmed_payment(\n  p_org_id text, p_plan text, p_interval text, p_amount_paise integer, p_period_start date default current_date, p_note text default null\n)')
    expect(MIGRATION).toContain('create or replace function public.dpdp_mark_commission_paid(p_commission_id text, p_note text default null)')
    // and nothing in this migration redefines the sign-up RPC, which the older Next.js path and another work stream share
    expect(MIGRATION).not.toMatch(/create or replace function public\.dpdp_create_my_org/i)
  })
})
