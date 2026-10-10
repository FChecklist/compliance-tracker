/// <reference types="bun-types" />
// DPDP online payment + trial/renewal reminder lifecycle (drizzle/0673_dpdp_razorpay_sales_lifecycle.sql):
// behaviour proof on PGlite (real Postgres compiled to WASM -- no server, the live database is never touched).
//
// Written for the use-case catalogue (dpdp-app/USE-CASES.md, groups F and H). It pins the TIMING and the
// "what can go wrong" of the money/reminder path, which the pure tests (dpdp-pay-logic.test.ts,
// dpdp-billing-mail.test.ts) cannot reach because the rules live in SQL:
//   * the exact second each reminder (trial10 / trial3 / trial0 / renew30 / renew7) opens and closes;
//   * "never sent twice": claim/mark, a failed send retried, a stale claim retaken, a sent one never;
//   * who is NOT mailed (unsubscribed owner, revoked owner, org already paid / awaiting confirmation,
//     an organisation whose trial ended long ago -- no mass mailing);
//   * dpdp_pay_confirm: booked exactly once however many events/retries carry the payment, a second
//     different payment on a paid attempt is flagged not booked, wrong amount/currency/unknown order are
//     refused without booking, and a replay of a booked event is a quiet duplicate;
//   * dpdp_pay_begin: owner only, yearly only, an edition is required, 10 attempts an hour.
//
// The stand-ins for the base tables and the older functions mirror dpdp-partner-lifecycle.pglite.test.ts: the
// function bodies that matter are copied out of drizzle/0604, 0605 and 0655 at run time, not retyped.
//
// Run: bun test --isolate src/lib/services/dpdp-sales-lifecycle.pglite.test.ts
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
create table dpdp.email_preference (membership_id text primary key, unsubscribed_at timestamptz, statutory_only boolean not null default false, updated_at timestamptz not null default now());
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
${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_identity_id')}
${fnFrom('drizzle/0604_dpdp_wo011_step2_browser_rpc.sql', 'dpdp__caller_membership')}
${fnFrom('drizzle/0605_dpdp_wo011_step3_owner_rpc.sql', 'dpdp__append_event')}
${fnFrom('drizzle/0655_dpdp_wo016_refer_and_earn.sql', 'dpdp_record_confirmed_payment')}
`

let db: PGlite
const T = '2027-03-31 23:30:00' // a trial end, UTC, deliberately 23:30 so the UTC date and the IST date differ

/** Reminder kinds listed for one org at a given instant (UTC), e.g. 'trial3', or 'none'. */
async function listed(orgId: string, nowUtc: string): Promise<string> {
  const r = await db.query<{ k: string }>(
    `select coalesce(string_agg(e->>'kind', ',' order by e->>'kind'), 'none') as k
       from jsonb_array_elements(public.dpdp_sales_due_reminders($1::timestamptz, 2000)) e where e->>'orgId' = $2`,
    [nowUtc + '+00', orgId],
  )
  return r.rows[0].k
}
const at = (offset: string) => db.query<{ t: string }>(`select to_char(timestamp '${T}' + interval '${offset}', 'YYYY-MM-DD HH24:MI:SS') as t`).then((r) => r.rows[0].t)

async function seedOrg(id: string, opts: { state?: string; trialEnds?: string | null; product?: string | null; email?: string } = {}) {
  const email = opts.email ?? `${id}@owner.test`
  await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2)`, [`i_${id}`, email])
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true)`, [`ie_${id}`, `i_${id}`, email])
  await db.query(`insert into dpdp.organisation (id, name, slug, product) values ($1, $2, $3, $4)`, [id, `Org ${id}`, id, opts.product === undefined ? 'firm' : opts.product])
  await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ($1, $2, $3, 'owner', 'created')`, [`m_${id}`, `i_${id}`, id])
  await db.query(`insert into dpdp.subscription (org_id, trial_ends_at, state) values ($1, $2, $3)`, [id, opts.trialEnds === undefined ? T : opts.trialEnds, opts.state ?? 'trial'])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  await db.exec(read('drizzle/0673_dpdp_razorpay_sales_lifecycle.sql'))
  await db.exec(read('drizzle/0673_dpdp_razorpay_sales_lifecycle.sql')) // idempotent
}, 120_000)

describe('trial reminder windows (U-F: trial 30 days -> reminders at 10, 3 and 0 days)', () => {
  beforeAll(async () => { await seedOrg('trialA') })

  const cases: Array<[string, string]> = [
    ['-10 days -1 second', 'none'], // a second before day 20: nothing
    ['-10 days', 'trial10'], //          day 20 opens trial10
    ['-7 days -1 second', 'trial10'], // its 3-day catch-up window is still open
    ['-7 days', 'none'], //              closed: nothing on day 23..26
    ['-3 days -1 second', 'none'],
    ['-3 days', 'trial3'], //            day 27 opens trial3
    ['-1 second', 'trial3'], //          last second of the trial
    ['0 seconds', 'trial0'], //          the instant the trial ends: trial3 is over, trial0 begins, never both
    ['3 days -1 second', 'trial0'],
    ['3 days', 'none'], //               closed: day 33 on
    ['60 days', 'none'], //              ended long ago: no mass mailing
    ['400 days', 'none'],
  ]
  for (const [offset, expected] of cases) {
    test(`T${offset.startsWith('-') ? '' : '+'}${offset} -> ${expected}`, async () => {
      expect(await listed('trialA', await at(offset))).toBe(expected)
    })
  }

  test('the three windows never overlap: at no instant are two trial reminders due for one org', async () => {
    for (let h = -260; h <= 80; h += 1) {
      const got = await listed('trialA', await at(`${h} hours`))
      expect(got.split(',').length, `T${h}h -> ${got}`).toBeLessThanOrEqual(1)
    }
  })

  test('reminder_key carries the trial-end DATE in UTC, daysLeft rounds up and never goes below 0', async () => {
    const r = await db.query<{ e: { reminderKey: string; daysLeft: number; dueDate: string } }>(
      `select e from jsonb_array_elements(public.dpdp_sales_due_reminders($1::timestamptz, 2000)) e where e->>'orgId' = 'trialA'`, [`${await at('-3 days')}+00`])
    expect(r.rows[0].e.reminderKey).toBe('trial3:2027-03-31') // UTC date 31 March, although it is 1 April in IST
    expect(r.rows[0].e.daysLeft).toBe(3)
    expect(r.rows[0].e.dueDate).toBe('2027-03-31T23:30:00Z')
    const after = await db.query<{ e: { daysLeft: number } }>(
      `select e from jsonb_array_elements(public.dpdp_sales_due_reminders($1::timestamptz, 2000)) e where e->>'orgId' = 'trialA'`, [`${await at('1 day')}+00`])
    expect(after.rows[0].e.daysLeft).toBe(0)
  })

  test('a null now uses the real clock without raising, and a limit of 0 or below is clamped, not an error', async () => {
    await db.query(`select public.dpdp_sales_due_reminders(null, null)`)
    const r = await db.query<{ n: number }>(`select jsonb_array_length(public.dpdp_sales_due_reminders($1::timestamptz, 0)) as n`, [`${await at('-3 days')}+00`])
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1) // limit 0 -> 1
    await db.query(`select public.dpdp_sales_due_reminders(now(), -5)`)
  })
})

describe('who is NOT mailed', () => {
  test('an organisation that has paid (active) or declared payment (awaiting_confirmation) gets no trial reminder', async () => {
    await seedOrg('paidB', { state: 'active' })
    await seedOrg('claimB', { state: 'awaiting_confirmation' })
    const now = await at('-3 days')
    expect(await listed('paidB', now)).toBe('none')
    expect(await listed('claimB', now)).toBe('none')
  })

  test('an owner who unsubscribed gets nothing', async () => {
    await seedOrg('unsubC')
    await db.query(`insert into dpdp.email_preference (membership_id, unsubscribed_at) values ('m_unsubC', now())`)
    expect(await listed('unsubC', await at('-3 days'))).toBe('none')
  })

  test('a revoked owner, an owner with no primary email, and a null trial end are skipped (no row, no error)', async () => {
    await seedOrg('revokedD')
    await db.query(`update dpdp.membership set state = 'revoked' where id = 'm_revokedD'`)
    await seedOrg('noPrimaryE')
    await db.query(`update dpdp.identity_email set is_primary = false where id = 'ie_noPrimaryE'`)
    await seedOrg('nullEndF', { trialEnds: null })
    const now = await at('-3 days')
    expect(await listed('revokedD', now)).toBe('none')
    expect(await listed('noPrimaryE', now)).toBe('none')
    expect(await listed('nullEndF', now)).toBe('none')
  })

  test('only the earliest-joined active owner is the recipient when there are two owners', async () => {
    await seedOrg('twoG')
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_twoG2', 'second@owner.test')`)
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_twoG2', 'i_twoG2', 'second@owner.test', true)`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via, created_at) values ('m_twoG2', 'i_twoG2', 'twoG', 'owner', 'invited', now() + interval '1 day')`)
    const r = await db.query<{ n: number; to: string }>(
      `select count(*)::int as n, min(e->>'ownerEmail') as "to" from jsonb_array_elements(public.dpdp_sales_due_reminders($1::timestamptz, 2000)) e where e->>'orgId' = 'twoG'`, [`${await at('-3 days')}+00`])
    expect(r.rows[0]).toEqual({ n: 1, to: 'twoG@owner.test' })
  })

  test('the hostile org name never reaches SQL as code: the worklist returns it as inert data', async () => {
    const evil = `Robert'); DROP TABLE dpdp.subscription;-- <script>alert(1)</script> कंपनी 🚀`
    await seedOrg('evilH')
    await db.query(`update dpdp.organisation set name = $1 where id = 'evilH'`, [evil])
    const r = await db.query<{ name: string }>(
      `select e->>'orgName' as name from jsonb_array_elements(public.dpdp_sales_due_reminders($1::timestamptz, 2000)) e where e->>'orgId' = 'evilH'`, [`${await at('-3 days')}+00`])
    expect(r.rows[0].name).toBe(evil)
    await db.query(`select 1 from dpdp.subscription limit 1`) // the table is still there
  })
})

describe('never sent twice: claim / mark', () => {
  const KEY = 'trial3:2027-03-31'
  beforeAll(async () => { await seedOrg('claimI') })

  test('first claim wins, an overlapping second claim loses, and a claimed reminder is not listed', async () => {
    expect((await db.query<{ r: { claimed: boolean } }>(`select public.dpdp_sales_reminder_claim('claimI', $1, 'x@owner.test') as r`, [KEY])).rows[0].r.claimed).toBe(true)
    expect((await db.query<{ r: { claimed: boolean } }>(`select public.dpdp_sales_reminder_claim('claimI', $1, 'x@owner.test') as r`, [KEY])).rows[0].r.claimed).toBe(false)
    expect(await listed('claimI', await at('-2 days'))).toBe('none')
  })

  test('a failed send (bounce / undeliverable / Resend down) is listed again and can be re-claimed', async () => {
    await db.query(`select public.dpdp_sales_reminder_mark('claimI', $1, 'failed', 'Resend 500: ' || repeat('x', 900))`, [KEY])
    expect((await db.query<{ e: string }>(`select error as e from dpdp.sales_reminder_sent where org_id = 'claimI'`)).rows[0].e.length).toBe(500) // error text is capped
    expect(await listed('claimI', await at('-2 days'))).toBe('trial3')
    expect((await db.query<{ r: { claimed: boolean } }>(`select public.dpdp_sales_reminder_claim('claimI', $1, 'x@owner.test') as r`, [KEY])).rows[0].r.claimed).toBe(true)
  })

  test('a claim abandoned for 30+ minutes (the run crashed) is retaken; a fresh one is not', async () => {
    await db.query(`update dpdp.sales_reminder_sent set created_at = (clock_timestamp() at time zone 'UTC') - interval '29 minutes' where org_id = 'claimI'`)
    expect(await listed('claimI', await at('-2 days'))).toBe('none')
    expect((await db.query<{ r: { claimed: boolean } }>(`select public.dpdp_sales_reminder_claim('claimI', $1, 'x@owner.test') as r`, [KEY])).rows[0].r.claimed).toBe(false)
    await db.query(`update dpdp.sales_reminder_sent set created_at = (clock_timestamp() at time zone 'UTC') - interval '31 minutes' where org_id = 'claimI'`)
    expect(await listed('claimI', await at('-2 days'))).toBe('trial3')
    expect((await db.query<{ r: { claimed: boolean } }>(`select public.dpdp_sales_reminder_claim('claimI', $1, 'x@owner.test') as r`, [KEY])).rows[0].r.claimed).toBe(true)
  })

  test('a SENT reminder is never listed or claimed again, however long it has been', async () => {
    await db.query(`select public.dpdp_sales_reminder_mark('claimI', $1, 'sent')`, [KEY])
    await db.query(`update dpdp.sales_reminder_sent set created_at = (clock_timestamp() at time zone 'UTC') - interval '10 days' where org_id = 'claimI'`)
    expect(await listed('claimI', await at('-2 days'))).toBe('none')
    expect((await db.query<{ r: { claimed: boolean } }>(`select public.dpdp_sales_reminder_claim('claimI', $1, 'x@owner.test') as r`, [KEY])).rows[0].r.claimed).toBe(false)
  })

  test('marking something not claimed does nothing (no resurrection of a sent row)', async () => {
    const r = await db.query<{ r: { updated: boolean } }>(`select public.dpdp_sales_reminder_mark('claimI', $1, 'failed', 'late') as r`, [KEY])
    expect(r.rows[0].r.updated).toBe(false)
    expect((await db.query<{ s: string }>(`select status as s from dpdp.sales_reminder_sent where org_id = 'claimI'`)).rows[0].s).toBe('sent')
  })

  test('other reminders of the same org are independent (trial0 is still due after trial3 was sent)', async () => {
    expect(await listed('claimI', await at('0 seconds'))).toBe('trial0')
  })

  test('hostile reminder keys and statuses are refused, not executed', async () => {
    for (const bad of [`trial3:2027-03-31'; drop table dpdp.subscription;--`, 'trial3', 'trial3:27-3-31', 'trial99:2027-03-31', '', 'TRIAL3:2027-03-31', `trial3:2027-03-31\n`])
      await expect(db.query(`select public.dpdp_sales_reminder_claim('claimI', $1, 'x')`, [bad])).rejects.toThrow(/Unknown reminder key/)
    await expect(db.query(`select public.dpdp_sales_reminder_claim('claimI', null, 'x')`)).rejects.toThrow(/Unknown reminder key/)
    await expect(db.query(`select public.dpdp_sales_reminder_mark('claimI', $1, 'bogus')`, [KEY])).rejects.toThrow(/status must be sent or failed/)
    await db.query(`select 1 from dpdp.subscription limit 1`)
  })
})

describe('renewal reminders (yearly plan: 30 and 7 days before the anniversary)', () => {
  const PAID = '2026-03-31 12:00:00' // the latest yearly payment; renews 2027-03-31 12:00
  beforeAll(async () => {
    await seedOrg('renewJ', { state: 'active' })
    await db.query(`update dpdp.subscription set "interval" = 'year' where org_id = 'renewJ'`)
    await db.query(`insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, confirmed_at) values ('pay_j1', 'renewJ', 'firm', 'year', 999900, $1)`, [PAID])
    await seedOrg('monthlyK', { state: 'active' })
    await db.query(`update dpdp.subscription set "interval" = 'month' where org_id = 'monthlyK'`)
    await db.query(`insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, confirmed_at) values ('pay_k1', 'monthlyK', 'firm', 'month', 199900, $1)`, [PAID])
  })
  const R = '2027-03-31 12:00:00'
  const rat = (offset: string) => db.query<{ t: string }>(`select to_char(timestamp '${R}' + interval '${offset}', 'YYYY-MM-DD HH24:MI:SS') as t`).then((x) => x.rows[0].t)

  for (const [offset, expected] of [['-30 days -1 second', 'none'], ['-30 days', 'renew30'], ['-27 days -1 second', 'renew30'], ['-27 days', 'none'], ['-7 days -1 second', 'none'], ['-7 days', 'renew7'], ['-4 days -1 second', 'renew7'], ['-4 days', 'none'], ['0 seconds', 'none'], ['30 days', 'none']] as const)
    test(`R${offset.startsWith('-') ? '' : '+'}${offset} -> ${expected}`, async () => { expect(await listed('renewJ', await rat(offset))).toBe(expected) })

  test('a monthly plan is never sent a renewal reminder (only yearly renews by anniversary)', async () => {
    expect(await listed('monthlyK', await rat('-30 days'))).toBe('none')
  })

  test('a second yearly payment moves the anniversary: the old date no longer reminds, the new one does', async () => {
    await db.query(`insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, confirmed_at) values ('pay_j2', 'renewJ', 'firm', 'year', 999900, '2027-03-30 12:00:00')`)
    expect(await listed('renewJ', await rat('-30 days'))).toBe('none')
    expect(await listed('renewJ', '2028-03-01 12:00:00')).toBe('renew30') // the new anniversary is 2028-03-30 12:00; 30 days before it is 2028-02-29 (a leap year)
  })

  test('leap day: a payment on 29 Feb renews on 28 Feb (PostgreSQL clamps), never skipping a year', async () => {
    await seedOrg('leapL', { state: 'active' })
    await db.query(`update dpdp.subscription set "interval" = 'year' where org_id = 'leapL'`)
    await db.query(`insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, confirmed_at) values ('pay_l1', 'leapL', 'firm', 'year', 999900, '2028-02-29 06:00:00')`)
    expect(await listed('leapL', '2029-01-29 06:00:00')).toBe('renew30')
    expect(await listed('leapL', '2029-02-21 06:00:00')).toBe('renew7')
  })
})

describe('online payment confirmation: exactly once (U-G)', () => {
  async function attempt(id: string, orgId: string, amount = 999900, link = `plink_${id}`) {
    await db.query(`insert into dpdp.payment_attempt (id, org_id, plan, "interval", amount_paise) values ($1, $2, 'firm', 'year', $3)`, [id, orgId, amount])
    await db.query(`select public.dpdp_pay_attempt_link($1, $2, 'https://rzp.io/i/x', $3)`, [id, link, `order_${id}`])
  }
  const confirm = async (ev: string, pay: string, link: string, amount = 999900, currency = 'INR', order: string | null = null, ref: string | null = null) =>
    (await db.query<{ r: Record<string, unknown> }>(`select public.dpdp_pay_confirm($1, 'payment_link.paid', $2, $3, $4, $5, $6, $7, 'upi') as r`, [ev, pay, link, order, ref, amount, currency])).rows[0].r

  test('a captured payment books once: org flips to active, a payment row exists, the attempt is paid', async () => {
    await seedOrg('payM')
    await attempt('att_m', 'payM')
    const r = await confirm('evt_m1', 'pay_rzp_m', 'plink_att_m')
    expect(r.ok).toBe(true)
    expect(r.duplicate).toBe(false)
    expect((await db.query<{ s: string; i: string }>(`select state as s, "interval" as i from dpdp.subscription where org_id = 'payM'`)).rows[0]).toEqual({ s: 'active', i: 'year' })
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'payM'`)).rows[0].n).toBe(1)
    expect((await db.query<{ s: string; p: string }>(`select status as s, razorpay_payment_id as p from dpdp.payment_attempt where id = 'att_m'`)).rows[0]).toEqual({ s: 'paid', p: 'pay_rzp_m' })
  })

  test('REPLAY: the same event again, and the same payment under a different event id, never book twice', async () => {
    const again = await confirm('evt_m1', 'pay_rzp_m', 'plink_att_m')
    expect(again).toEqual({ ok: true, duplicate: true })
    const other = await confirm('evt_m2', 'pay_rzp_m', 'plink_att_m') // payment.captured AND payment_link.paid both fire for one payment
    expect(other).toEqual({ ok: true, duplicate: true })
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'payM'`)).rows[0].n).toBe(1)
  })

  test('a DIFFERENT payment on an attempt already paid is flagged for a human, not booked', async () => {
    const r = await confirm('evt_m3', 'pay_rzp_m_other', 'plink_att_m')
    expect(r).toEqual({ ok: false, reason: 'attempt_already_paid' })
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'payM'`)).rows[0].n).toBe(1)
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.event where org_id = 'payM' and kind = 'payment_review_needed'`)).rows[0].n).toBe(1)
    expect((await db.query<{ o: string }>(`select outcome as o from dpdp.razorpay_event where event_id = 'evt_m3'`)).rows[0].o).toBe('attempt_already_paid')
  })

  test('wrong amount (1 paise short, more) and wrong currency are refused, nothing is booked, the attempt is marked mismatch', async () => {
    await seedOrg('payN')
    await attempt('att_n', 'payN')
    expect(await confirm('evt_n1', 'pay_n1', 'plink_att_n', 999899)).toEqual({ ok: false, reason: 'amount_mismatch' })
    expect((await db.query<{ s: string }>(`select status as s from dpdp.payment_attempt where id = 'att_n'`)).rows[0].s).toBe('mismatch')
    expect(await confirm('evt_n2', 'pay_n2', 'plink_att_n', 1999800)).toEqual({ ok: false, reason: 'amount_mismatch' })
    expect(await confirm('evt_n3', 'pay_n3', 'plink_att_n', 999900, 'USD')).toEqual({ ok: false, reason: 'currency_mismatch' })
    expect((await db.query<{ n: number }>(`select count(*)::int as n from dpdp.payment where org_id = 'payN'`)).rows[0].n).toBe(0)
    expect((await db.query<{ s: string }>(`select state as s from dpdp.subscription where org_id = 'payN'`)).rows[0].s).toBe('trial') // access and state untouched
  })

  test('a refused payment can still be booked once the CORRECT payment arrives (mismatch is not terminal)', async () => {
    const r = await confirm('evt_n4', 'pay_n4', 'plink_att_n', 999900)
    expect(r.ok).toBe(true)
    expect((await db.query<{ s: string }>(`select state as s from dpdp.subscription where org_id = 'payN'`)).rows[0].s).toBe('active')
  })

  test('an unknown order is refused and logged; an empty payment or event id raises (so Razorpay retries nothing wrong)', async () => {
    expect(await confirm('evt_x1', 'pay_x1', 'plink_does_not_exist')).toEqual({ ok: false, reason: 'unknown_order' })
    await expect(db.query(`select public.dpdp_pay_confirm('evt', '', 'l', null, null, 1, 'INR', null)`)).rejects.toThrow()
    await expect(db.query(`select public.dpdp_pay_confirm('', 'e', 'p', 'l', null, null, 1, 'INR', null)`)).rejects.toThrow()
  })

  test('the payment is found by reference id (our attempt id) when the link id is absent; notes never choose the org', async () => {
    await seedOrg('payO')
    await attempt('att_o', 'payO')
    const r = await confirm('evt_o1', 'pay_o1', null as unknown as string, 999900, 'inr', null, 'att_o') // lower-case currency still equals
    expect(r.ok).toBe(true)
    expect((await db.query<{ o: string }>(`select org_id as o from dpdp.payment where razorpay_payment_id = 'pay_o1'`)).rows[0].o).toBe('payO')
  })

  test('the same Razorpay payment id can never be stored on two payment rows (unique index)', async () => {
    await expect(db.query(`insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, razorpay_payment_id) values ('dup1', 'payO', 'firm', 'year', 1, 'pay_o1')`)).rejects.toThrow(/duplicate key|unique/i)
  })

  test('dpdp_pay_log_event never overwrites a recorded row and ignores a blank event id', async () => {
    await db.query(`select public.dpdp_pay_log_event('evt_m1', 'x', 'p', 'att_m', 'unknown_order')`)
    expect((await db.query<{ o: string }>(`select outcome as o from dpdp.razorpay_event where event_id = 'evt_m1'`)).rows[0].o).toBe('recorded')
    expect((await db.query<{ r: { ok: boolean } }>(`select public.dpdp_pay_log_event('  ', 'x', 'p', null, 'unknown_order') as r`)).rows[0].r.ok).toBe(false)
  })

  test('an attempt that never got a link can be cancelled; one that has a link cannot, and a paid one cannot get a new link', async () => {
    await seedOrg('payP')
    await db.query(`insert into dpdp.payment_attempt (id, org_id, plan, "interval", amount_paise) values ('att_p_nolink', 'payP', 'firm', 'year', 999900)`)
    expect((await db.query<{ r: { cancelled: boolean } }>(`select public.dpdp_pay_attempt_cancel('att_p_nolink') as r`)).rows[0].r.cancelled).toBe(true)
    await attempt('att_p', 'payP')
    expect((await db.query<{ r: { cancelled: boolean } }>(`select public.dpdp_pay_attempt_cancel('att_p') as r`)).rows[0].r.cancelled).toBe(false)
    await expect(db.query(`select public.dpdp_pay_attempt_link('att_m', 'plink_other', 'https://rzp.io/i/y')`)).rejects.toThrow(/No open payment attempt/)
  })
})

describe('"Pay online" (dpdp_pay_begin): owner only, yearly only, rate-limited', () => {
  const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ email })])

  test('the owner of an edition gets a server-side price (never one chosen by the browser)', async () => {
    await seedOrg('begQ')
    await as('begQ@owner.test')
    const r = (await db.query<{ r: { amountPaise: number; currency: string; interval: string } }>(`select public.dpdp_pay_begin('year') as r`)).rows[0].r
    expect(r.amountPaise).toBe(999900)
    expect(r.currency).toBe('INR')
  })

  test('monthly, garbage and null intervals are refused (online payment is yearly only)', async () => {
    await as('begQ@owner.test')
    for (const bad of ['month', 'YEAR', "year'; drop table dpdp.payment;--", '']) await expect(db.query(`select public.dpdp_pay_begin($1)`, [bad])).rejects.toThrow(/yearly plan/)
    await expect(db.query(`select public.dpdp_pay_begin(null)`)).rejects.toThrow(/yearly plan/)
  })

  test('staff, a stranger and an anonymous caller are refused', async () => {
    await seedOrg('begR')
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_staff', 'staff@x.test')`)
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_staff', 'i_staff', 'staff@x.test', true)`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_staff', 'i_staff', 'begR', 'staff', 'invited')`)
    await as('staff@x.test')
    await expect(db.query(`select public.dpdp_pay_begin('year')`)).rejects.toThrow(/Only the owner/)
    await as('stranger@nowhere.test')
    await expect(db.query(`select public.dpdp_pay_begin('year')`)).rejects.toThrow(/Not a member/)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
    await expect(db.query(`select public.dpdp_pay_begin('year')`)).rejects.toThrow(/Not a member/)
  })

  test('an organisation with no edition cannot be charged', async () => {
    await seedOrg('begS', { product: null })
    await as('begS@owner.test')
    await expect(db.query(`select public.dpdp_pay_begin('year')`)).rejects.toThrow(/no edition/)
  })

  test('the 11th attempt inside an hour is refused (double-click / script guard); the first ten are fine', async () => {
    await seedOrg('begT')
    await as('begT@owner.test')
    for (let i = 0; i < 10; i++) await db.query(`select public.dpdp_pay_begin('year')`)
    await expect(db.query(`select public.dpdp_pay_begin('year')`)).rejects.toThrow(/Too many payment attempts/)
    // ...and attempts older than an hour stop counting
    await db.query(`update dpdp.payment_attempt set created_at = (clock_timestamp() at time zone 'UTC') - interval '61 minutes' where org_id = 'begT'`)
    await db.query(`select public.dpdp_pay_begin('year')`)
  })
})

describe('the money and reminder tables are not reachable from a browser role', () => {
  test('anon and authenticated have no table privileges; the worklist and payment functions are service_role only', async () => {
    for (const t of ['dpdp.payment_attempt', 'dpdp.razorpay_event', 'dpdp.sales_reminder_sent'])
      for (const role of ['anon', 'authenticated']) {
        const r = await db.query<{ ok: boolean }>(`select has_table_privilege('${role}', '${t}', 'select,insert,update,delete') as ok`)
        expect(r.rows[0].ok, `${role} on ${t}`).toBe(false)
      }
    for (const fn of ['dpdp_sales_due_reminders(timestamptz, integer)', 'dpdp_sales_reminder_claim(text, text, text)', 'dpdp_sales_reminder_mark(text, text, text, text)', 'dpdp_pay_confirm(text, text, text, text, text, text, integer, text, text)', 'dpdp_pay_attempt_lookup(text, text, text)']) {
      for (const role of ['anon', 'authenticated']) expect((await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', 'public.${fn}', 'execute') as ok`)).rows[0].ok, `${role} ${fn}`).toBe(false)
      expect((await db.query<{ ok: boolean }>(`select has_function_privilege('service_role', 'public.${fn}', 'execute') as ok`)).rows[0].ok, `service_role ${fn}`).toBe(true)
    }
    // dpdp_pay_begin is the one browser-callable entry, and only for a signed-in user
    expect((await db.query<{ ok: boolean }>(`select has_function_privilege('anon', 'public.dpdp_pay_begin(text, text)', 'execute') as ok`)).rows[0].ok).toBe(false)
    expect((await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.dpdp_pay_begin(text, text)', 'execute') as ok`)).rows[0].ok).toBe(true)
  })
})
