/// <reference types="bun-types" />
// DPDP bank-transfer payment claim flow (drizzle/0658_dpdp_payment_confirmation_flow.sql): "I have paid" -> the platform owner
// approves or rejects. Offline proof on PGlite (the live database is never touched). Use-case catalogue rows D08, H02, F06.
//
// The base tables are stand-ins; the function bodies under test, and the older money function they call, are copied out of the
// migration files at run time (not retyped), as in dpdp-partner-lifecycle.pglite.test.ts.
//
// What this pins: the claim changes NOTHING about access (only the subscription state and one event); only the organisation's owner
// can declare; only a platform admin can list, approve or reject; approval books exactly what was DECLARED (never an amount the
// approver types) and exactly once; a rejected claim returns the org to a plain trial; a referred org's approved yearly payment earns
// the partner 20%; hostile text in the reference or note is stored as inert data.
//
// Run: bun test --isolate src/lib/services/dpdp-payment-claim.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const REPO_ROOT = new URL('../../../', import.meta.url)
const read = (rel: string) => readFileSync(new URL(rel, REPO_ROOT), 'utf8').replace(/\r\n/g, '\n')
function fnFrom(file: string, name: string): string {
  const all = read(file).match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'g'))
  if (!all || all.length === 0) throw new Error(`${file}: function ${name} not found`)
  return all[all.length - 1]
}
const F658 = 'drizzle/0658_dpdp_payment_confirmation_flow.sql'
// 0676 supersedes two of 0658's functions (reject keeps an active org active; approve says plainly when there is no edition).
const F676 = 'drizzle/0676_dpdp_claim_reject_and_ai_link_billing_notice.sql'

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
create table dpdp.organisation (id text primary key, name text not null, slug text unique not null, product text, created_at timestamp not null default now());
create table dpdp.membership (
  id text primary key, identity_id text not null references dpdp.identity (id), org_id text not null references dpdp.organisation (id),
  level dpdp.membership_level not null, can_sign boolean not null default false, state dpdp.membership_state not null default 'active',
  joined_via dpdp.joined_via not null, created_at timestamp not null default now(), revoked_at timestamp, unique (identity_id, org_id)
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
${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_identity_id')}
${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_membership')}
${fnFrom('drizzle/0605_dpdp_wo011_step3_owner_rpc.sql', 'dpdp__append_event')}
${fnFrom('drizzle/0655_dpdp_wo016_refer_and_earn.sql', 'dpdp_record_confirmed_payment')}
${fnFrom(F658, 'dpdp__is_platform_admin')}
${fnFrom(F658, 'dpdp_declare_payment')}
${fnFrom(F658, 'dpdp__require_platform_admin')}
${fnFrom(F658, 'dpdp_owner_pending_claims')}
${fnFrom(F676, 'dpdp_owner_approve_payment')}
${fnFrom(F676, 'dpdp_owner_reject_payment')}
`

let db: PGlite
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(email ? { email } : {})])
type J = Record<string, unknown>
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r

async function org(id: string, product: string | null = 'firm', state = 'trial') {
  await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2)`, [`i_${id}`, `${id}@owner.test`])
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true)`, [`ie_${id}`, `i_${id}`, `${id}@owner.test`])
  await db.query(`insert into dpdp.organisation (id, name, slug, product) values ($1, $2, $3, $4)`, [id, `Org ${id}`, id, product])
  await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ($1, $2, $3, 'owner', 'created')`, [`m_${id}`, `i_${id}`, id])
  await db.query(`insert into dpdp.subscription (org_id, trial_ends_at, state) values ($1, timestamp '2027-01-31 10:00:00', $2)`, [id, state])
}
const sub = async (id: string) => (await db.query<Record<string, unknown>>(`select * from dpdp.subscription where org_id = $1`, [id])).rows[0]
const events = async (id: string, kind: string) => (await db.query<{ n: number }>(`select count(*)::int as n from dpdp.event where org_id = $1 and kind = $2`, [id, kind])).rows[0].n

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  await db.query(`insert into dpdp.platform_admin (email) values ('admin@veridian.test')`)
}, 120_000)

describe('declaring a payment ("I have paid")', () => {
  test('the owner declares: state becomes awaiting_confirmation, the claim is recorded, ONE event is written, nothing else changes', async () => {
    await org('a1')
    await as('a1@owner.test')
    const r = await one(`select public.dpdp_declare_payment('year', 999900, null, '  UTR123456789  ', 'proofs/a1.png', ' paid from the firm account ') as r`)
    expect(r).toEqual({ ok: true, state: 'awaiting_confirmation' })
    const s = await sub('a1')
    expect(s.state).toBe('awaiting_confirmation')
    expect(s.self_declared_reference).toBe('UTR123456789') // trimmed
    expect(s.self_declared_note).toBe('paid from the firm account')
    expect(s.self_declared_amount_paise).toBe(999900)
    expect(String(s.trial_ends_at)).toContain('2027') // the trial date is left alone
    expect(await events('a1', 'payment_declared')).toBe(1)
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'a1'`)).rows[0].n).toBe(0) // a claim is not money
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.membership where org_id = 'a1' and state = 'active'`)).rows[0].n).toBe(1) // access untouched
  })

  test('blank reference and note become null, not empty strings', async () => {
    await org('a2')
    await as('a2@owner.test')
    await db.query(`select public.dpdp_declare_payment('month', 199900, null, '   ', null, '')`)
    const s = await sub('a2')
    expect(s.self_declared_reference).toBeNull()
    expect(s.self_declared_note).toBeNull()
  })

  test('refused: a bad interval, a zero, negative or null amount, a staff member, a stranger, an anonymous caller', async () => {
    await org('a3')
    await as('a3@owner.test')
    for (const bad of ['week', 'YEAR', "year'; drop table dpdp.payment;--", '']) await expect(db.query(`select public.dpdp_declare_payment($1, 999900)`, [bad])).rejects.toThrow(/interval must be/)
    for (const bad of [0, -1, null]) await expect(db.query(`select public.dpdp_declare_payment('year', $1)`, [bad])).rejects.toThrow(/positive number/)
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_staff3', 'staff3@x.test')`)
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_staff3', 'i_staff3', 'staff3@x.test', true)`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_staff3', 'i_staff3', 'a3', 'staff', 'invited')`)
    await as('staff3@x.test')
    await expect(db.query(`select public.dpdp_declare_payment('year', 999900, 'a3')`)).rejects.toThrow(/Only the owner/)
    await as('stranger@nowhere.test')
    await expect(db.query(`select public.dpdp_declare_payment('year', 999900)`)).rejects.toThrow(/Not a member/)
    await as('')
    await expect(db.query(`select public.dpdp_declare_payment('year', 999900)`)).rejects.toThrow(/Not a member/)
    expect((await sub('a3')).state).toBe('trial') // every refusal left the org alone
  })

  test('hostile text in the reference and note is stored as inert data, never run', async () => {
    await org('a4')
    await as('a4@owner.test')
    const evil = `'); drop table dpdp.subscription;-- <script>alert(1)</script> कंपनी 🚀`
    await db.query(`select public.dpdp_declare_payment('year', 999900, null, $1, null, $1)`, [evil])
    expect((await sub('a4')).self_declared_reference).toBe(evil)
  })

  test('declaring twice replaces the claim (one claim per org), and an ACTIVE org declaring again (a renewal) goes back to awaiting_confirmation', async () => {
    await org('a5', 'firm', 'active')
    await as('a5@owner.test')
    await db.query(`select public.dpdp_declare_payment('year', 999900, null, 'REF1')`)
    await db.query(`select public.dpdp_declare_payment('year', 999900, null, 'REF2')`)
    const s = await sub('a5')
    expect(s.state).toBe('awaiting_confirmation')
    expect(s.self_declared_reference).toBe('REF2')
  })
})

describe('the platform owner reviews claims', () => {
  test('a normal owner or anonymous caller cannot list, approve or reject', async () => {
    for (const who of ['a1@owner.test', '']) {
      await as(who)
      await expect(db.query(`select public.dpdp_owner_pending_claims()`)).rejects.toThrow(/Owner only/)
      await expect(db.query(`select public.dpdp_owner_approve_payment('a1')`)).rejects.toThrow(/Owner only/)
      await expect(db.query(`select public.dpdp_owner_reject_payment('a1')`)).rejects.toThrow(/Owner only/)
    }
    expect((await sub('a1')).state).toBe('awaiting_confirmation')
  })

  test('the admin sees every waiting claim, oldest first, with the owner e-mail; case and spaces in the admin e-mail do not matter', async () => {
    await as('  Admin@Veridian.TEST ')
    const claims = await one<Array<{ orgId: string }>>(`select public.dpdp_owner_pending_claims() as r`)
    const ids = claims.map((c) => c.orgId)
    expect(ids).toEqual(expect.arrayContaining(['a1', 'a2', 'a4', 'a5']))
    expect(ids).not.toContain('a3')
  })

  test('approve books EXACTLY what was declared, once: org active, payment row, receipt note carries the reference', async () => {
    await as('admin@veridian.test')
    const r = await one(`select public.dpdp_owner_approve_payment('a1', 'seen in HDFC') as r`)
    expect(r.ok).toBe(true)
    const s = await sub('a1')
    expect(s.state).toBe('active')
    expect(s.interval).toBe('year')
    const pay = (await db.query<{ amount_paise: number; interval: string; plan: string; confirmed_note: string }>(`select * from dpdp.payment where org_id = 'a1'`)).rows
    expect(pay).toHaveLength(1)
    expect(pay[0].amount_paise).toBe(999900) // the declared amount; the approver cannot type another
    expect(pay[0].plan).toBe('firm')
    expect(pay[0].confirmed_note).toBe('Ref UTR123456789. seen in HDFC')
    await expect(db.query(`select public.dpdp_owner_approve_payment('a1')`)).rejects.toThrow(/no payment awaiting confirmation/) // not twice
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'a1'`)).rows[0].n).toBe(1)
  })

  test('approve and reject refuse an unknown org, an org with no claim, and an org still in plain trial', async () => {
    await as('admin@veridian.test')
    await expect(db.query(`select public.dpdp_owner_approve_payment('nope')`)).rejects.toThrow(/No such organisation/)
    await expect(db.query(`select public.dpdp_owner_approve_payment('a3')`)).rejects.toThrow(/no payment awaiting confirmation/)
    await expect(db.query(`select public.dpdp_owner_reject_payment('a3')`)).rejects.toThrow(/no payment awaiting confirmation/)
    await expect(db.query(`select public.dpdp_owner_reject_payment('nope')`)).rejects.toThrow(/no payment awaiting confirmation/)
  })

  test('reject sends the org back to a plain trial, clears the claim, keeps the history in the event log, and cannot be repeated', async () => {
    await as('admin@veridian.test')
    const r = await one(`select public.dpdp_owner_reject_payment('a2', 'no such transfer') as r`)
    expect(r).toEqual({ ok: true, state: 'trial' })
    const s = await sub('a2')
    expect(s.state).toBe('trial')
    expect(s.self_declared_amount_paise).toBeNull()
    expect(s.self_declared_reference).toBeNull()
    expect(String(s.trial_ends_at)).toContain('2027') // trial date kept
    expect(await events('a2', 'payment_rejected')).toBe(1)
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'a2'`)).rows[0].n).toBe(0)
    await expect(db.query(`select public.dpdp_owner_reject_payment('a2')`)).rejects.toThrow(/no payment awaiting confirmation/)
  })

  test('a rejected org can claim again and be approved later (rejection is not terminal)', async () => {
    await as('a2@owner.test')
    await db.query(`select public.dpdp_declare_payment('month', 199900, null, 'RETRY')`)
    await as('admin@veridian.test')
    expect((await one(`select public.dpdp_owner_approve_payment('a2') as r`)).ok).toBe(true)
    expect((await sub('a2')).interval).toBe('month')
  })

  test('REFERRED org: an approved yearly claim earns the partner 20% of the declared amount, once', async () => {
    await org('b1', 'institution')
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_partner', 'partner@x.test')`)
    await db.query(`insert into dpdp.referral (identity_id, code) values ('i_partner', 'PARTNER1')`)
    await db.query(`insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('re1', 'i_partner', 'b1', 'signed_up')`)
    await as('b1@owner.test')
    await db.query(`select public.dpdp_declare_payment('year', 999900)`)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_approve_payment('b1')`)
    const c = (await db.query<{ amount_paise: number; rate: string; basis: string }>(`select * from dpdp.referral_commission where referral_event_id = 're1'`)).rows
    expect(c).toHaveLength(1)
    expect(c[0].amount_paise).toBe(199980)
    expect(c[0].basis).toBe('yearly')
    await expect(db.query(`select public.dpdp_owner_approve_payment('b1')`)).rejects.toThrow()
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.referral_commission where referral_event_id = 're1'`)).rows[0].n).toBe(1)
  })

  test('a BLOCKED referral (self-referral) never earns a commission when its claim is approved', async () => {
    await org('b2')
    await db.query(`insert into dpdp.referral (identity_id, code) values ('i_b2', 'SELFCODE')`)
    await db.query(`insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome, block_reason) values ('re2', 'i_b2', 'b2', 'blocked', 'self_referral')`)
    await as('b2@owner.test')
    await db.query(`select public.dpdp_declare_payment('year', 999900)`)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_approve_payment('b2')`)
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.referral_commission where referral_event_id = 're2'`)).rows[0].n).toBe(0)
  })

  test('an organisation with no edition cannot have a claim approved: a plain message, not a database error, and nothing booked', async () => {
    await org('b3', null)
    await as('b3@owner.test')
    await db.query(`select public.dpdp_declare_payment('year', 999900)`)
    await as('admin@veridian.test')
    const err = await db.query(`select public.dpdp_owner_approve_payment('b3')`).then(() => null, (e: Error) => e)
    expect(err).not.toBeNull()
    expect(err!.message).toMatch(/has not chosen an edition/)
    expect(err!.message).not.toMatch(/null value|violates|column/i)
    expect((await sub('b3')).state).toBe('awaiting_confirmation') // nothing half-booked
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'b3'`)).rows[0].n).toBe(0)
  })

  test('REJECT keeps an already-active organisation active (a refused renewal is not a return to trial), and clears the claim', async () => {
    await org('c1', 'firm', 'trial')
    await as('admin@veridian.test')
    // c1 pays and is confirmed once (state active, last_confirmed_at set, a payment row).
    await as('c1@owner.test')
    await db.query(`select public.dpdp_declare_payment('year', 999900, null, 'FIRST')`)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_approve_payment('c1')`)
    expect((await sub('c1')).state).toBe('active')
    // A year later it claims the renewal, and the claim is refused.
    await as('c1@owner.test')
    await db.query(`select public.dpdp_declare_payment('year', 999900, null, 'RENEWAL')`)
    expect((await sub('c1')).state).toBe('awaiting_confirmation')
    await as('admin@veridian.test')
    const r = await one(`select public.dpdp_owner_reject_payment('c1', 'not received') as r`)
    expect(r).toEqual({ ok: true, state: 'active' })
    const s = await sub('c1')
    expect(s.state).toBe('active')
    expect(s.interval).toBe('year') // the plan it already had is untouched
    expect(s.last_confirmed_at).not.toBeNull()
    expect(s.self_declared_reference).toBeNull() // the claim is cleared
    expect(await events('c1', 'payment_rejected')).toBe(1)
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'c1'`)).rows[0].n).toBe(1) // the first payment stays; the refused one never became money
  })

  test('REJECT of a first-ever claim (nothing ever confirmed) still goes back to trial', async () => {
    await org('c2')
    await as('c2@owner.test')
    await db.query(`select public.dpdp_declare_payment('month', 199900, null, 'X')`)
    await as('admin@veridian.test')
    expect(await one(`select public.dpdp_owner_reject_payment('c2') as r`)).toEqual({ ok: true, state: 'trial' })
    expect((await sub('c2')).state).toBe('trial')
  })
})
