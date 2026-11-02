/// <reference types="bun-types" />
// The new DPDP pricing (drizzle/0755_dpdp_pricing_trial_pack_and_per_client.sql), the owner's decisions of 2026-11-02, pinned to the paisa:
//   a Rs 99 three-month trial pack, once, for an account that has paid nothing; then Rs 999 a month or Rs 5,994 a year (half price);
//   a Professional's Rs 999 includes 10 clients and adds Rs 50 a month (Rs 300 a year) for every client beyond ten, counted on the real number (no tiers).
//   The extra-client price was Rs 20 in 0755 and became Rs 50 in drizzle/0756 (owner, later the same day); the tests below run both files, as the live database did;
//   the pack earns no commission; nobody is free; and the sign-up trap: an organisation made through dpdp_create_my_org alone now gets an account.
// Offline proof on PGlite (real Postgres as WASM): the live database is never touched. The migration files are executed whole, on the same stand-in
// base the billing test uses (src/lib/services/dpdp-pglite-base.ts). Stand-ins say so: the sign-up and client-creation originals, the three money
// RPC originals, dpdp.payment_attempt (only the columns the pay RPC writes) and the old flat price function (copied out of 0673, which 0755 then replaces).
//
// Run: bun test --isolate src/lib/services/dpdp-pricing-pack.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, fnFrom, read } from './dpdp-pglite-base'

const CHAIN = [
  'drizzle/0733_dpdp_visitor_journey.sql',
  'drizzle/0734_dpdp_account_opening_plans_billing.sql',
  'drizzle/0735_dpdp_test_live_mode_profile_capture.sql',
  'drizzle/0748_dpdp_terms_acceptance.sql',
]
const F0755 = 'drizzle/0755_dpdp_pricing_trial_pack_and_per_client.sql'
const F0756 = 'drizzle/0756_dpdp_extra_client_price_rs50.sql'
const D0756 = 'drizzle/down/0756_dpdp_extra_client_price_rs50.down.sql'
const TICK = `dpdp.terms_current_version(), true`
const PAYMENT_ATTEMPT_SQL = `create table dpdp.payment_attempt (
  id text primary key, org_id text not null references dpdp.organisation (id), plan text not null check (plan in ('firm', 'institution')),
  "interval" text not null constraint payment_attempt_interval_check check ("interval" in ('month', 'year')), amount_paise integer not null check (amount_paise > 0),
  created_by_identity_id text, product text, variation text, status text not null default 'created',
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
)`

let db: PGlite
type J = Record<string, any>
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(email ? { email } : {})])
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const DAY = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
const ago = (days: number) => iso(new Date(Date.now() - days * DAY))
let n = 0

async function openAccount(kind: 'firm' | 'institution') {
  const email = `owner${++n}@price.test`
  await as(email)
  const r = await one<J>(`select public.dpdp_open_account($1, $2, null, null, null, null, null, null, null, ${TICK}) as r`, [kind, `Org ${n}`])
  return { email, orgId: r.orgId as string, r }
}
const account = async (orgId: string) => (await rows<J>(`select * from dpdp.account where org_id = $1`, [orgId]))[0]
const stateOf = async (orgId: string) => (await one<J>(`select dpdp.org_billing_state($1) as r`, [orgId])) as unknown as string
const setClock = (orgId: string, openedDaysAgo: number, paidUntilDaysFromNow: number | null) =>
  db.query(`update dpdp.account set opened_at = $2, paid_until = $3 where org_id = $1`, [orgId, ago(openedDaysAgo), paidUntilDaysFromNow === null ? null : ago(-paidUntilDaysFromNow)])
/** k client organisations linked to a firm, written straight into the tables (the cap is tested in the billing test; here only the COUNT matters). */
async function giveClients(firm: string, k: number, tag: string) {
  await db.query(`insert into dpdp.organisation (id, name, slug, product) select $1::text || g::text, 'c', $1::text || g::text, 'institution' from generate_series(1, $2::int) g`, [tag, k])
  await db.query(`insert into dpdp.account_client (client_org_id, firm_org_id) select $1::text || g::text, $3::text from generate_series(1, $2::int) g`, [tag, k, firm])
}
const markPaid = async (orgId: string, interval: 'pack' | 'month' | 'year') => {
  await as('admin@veridian.test')
  return one<J>(`select public.dpdp_owner_mark_paid($1, $2) as r`, [orgId, interval])
}
/** Days from now until paid-until, worked out inside the database so the machine's time zone cannot matter. */
const daysLeft = async (orgId: string) =>
  Number((await rows<J>(`select extract(epoch from (paid_until - (clock_timestamp() at time zone 'utc'))) / 86400 as d from dpdp.account where org_id = $1`, [orgId]))[0].d)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  for (const f of CHAIN) await db.exec(read(f))
  await db.exec(PAYMENT_ATTEMPT_SQL)
  await db.exec(fnFrom('drizzle/0673_dpdp_razorpay_sales_lifecycle.sql', 'dpdp_plan_price_paise'))
  await db.exec(read(F0755))
  await db.exec(read(F0756))
  await db.query(`insert into dpdp.platform_admin (email) values ('admin@veridian.test')`)
  await db.query(`insert into dpdp.identity (id, primary_email) values ('i_admin', 'admin@veridian.test')`)
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_admin', 'i_admin', 'admin@veridian.test', true)`)
}, 180_000)

describe('the owner\'s price examples, to the paisa (monthly / yearly = 6 x monthly)', () => {
  const examples: Array<[number, number, number]> = [
    [10, 99_900, 599_400], // Rs 999 / Rs 5,994
    [50, 299_900, 1_799_400], // Rs 2,999 / Rs 17,994
    [100, 549_900, 3_299_400], // Rs 5,499 / Rs 32,994
    [500, 2_549_900, 15_299_400], // Rs 25,499 / Rs 1,52,994
    [1000, 5_049_900, 30_299_400], // Rs 50,499 / Rs 3,02,994
  ]
  for (const [clients, month, year] of examples) {
    test(`a Professional with ${clients} clients: Rs ${month / 100} a month, Rs ${year / 100} a year, in the account screen and at the pay door`, async () => {
      const f = await openAccount('firm')
      await giveClients(f.orgId, clients, `ex${clients}x`)
      await as(f.email)
      const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [f.orgId])
      expect(mine.money).toMatchObject({ monthPaise: month, yearPaise: year, monthlyPaise: month, baseMonthlyPaise: 99_900 })
      expect(mine.money.perClient).toEqual({ includedClients: 10, extraMonthlyPaise: 5000, clientsCounted: clients, extraClients: Math.max(clients - 10, 0) })
      const m = await one<J>(`select public.dpdp_pay_begin('month', $1, ${TICK}) as r`, [f.orgId])
      const y = await one<J>(`select public.dpdp_pay_begin('year', $1, ${TICK}) as r`, [f.orgId])
      expect([m.amountPaise, y.amountPaise]).toEqual([month, year])
      expect([m.variation, y.variation]).toEqual(['firm_month', 'firm_year'])
    })
  }

  test('an Organisation: Rs 999 a month, Rs 5,994 a year', async () => {
    const o = await openAccount('institution')
    await as(o.email)
    const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [o.orgId])
    expect(mine.money).toMatchObject({ monthPaise: 99_900, yearPaise: 599_400, perClient: { includedClients: 0, extraMonthlyPaise: 0, extraClients: 0 } })
    const y = await one<J>(`select public.dpdp_pay_begin('year', $1, ${TICK}) as r`, [o.orgId])
    expect([y.amountPaise, y.variation]).toEqual([599_400, 'institution_year'])
  })

  test('the count is on the ACTUAL number of clients, not tiers: 0, 1, 10 and 11 clients, and one more client is exactly Rs 50 more a month (Rs 300 more a year)', async () => {
    const f = await openAccount('firm')
    const monthly = async () => ((await rows<J>(`select dpdp.account_charge_paise(a, 'month') as p from dpdp.account a where a.org_id = $1`, [f.orgId]))[0].p as number)
    expect(await monthly()).toBe(99_900)
    await giveClients(f.orgId, 1, 'cnt1x')
    expect(await monthly()).toBe(99_900)
    await giveClients(f.orgId, 9, 'cnt9x')
    expect(await monthly()).toBe(99_900) // ten
    await giveClients(f.orgId, 1, 'cnt11x')
    expect(await monthly()).toBe(104_900) // eleven: +Rs 50
    const yearly = async () => ((await rows<J>(`select dpdp.account_charge_paise(a, 'year') as p from dpdp.account a where a.org_id = $1`, [f.orgId]))[0].p as number)
    expect(await yearly()).toBe(629_400) // eleven, a year: Rs 5,994 + Rs 300
    await giveClients(f.orgId, 1, 'cnt12x')
    expect(await monthly()).toBe(109_900)
    expect(await yearly()).toBe(659_400) // twelve, a year: Rs 5,994 + 2 x Rs 300
  })

  test('the price an account signed up at is the base; a change of the plan row\'s base price does not reach an account that already has its base locked', async () => {
    const f = await openAccount('firm')
    await giveClients(f.orgId, 12, 'lk12x')
    await db.query(`update dpdp.plan set list_monthly_paise = 119900, offer_monthly_paise = 119900 where key = 'firm'`)
    try {
      expect((await account(f.orgId)).locked_monthly_paise).toBe(99_900)
      const total = (await rows<J>(`select dpdp.account_monthly_total_paise(a) as p from dpdp.account a where a.org_id = $1`, [f.orgId]))[0].p
      expect(total).toBe(99_900 + 2 * 5000)
    } finally {
      await db.query(`update dpdp.plan set list_monthly_paise = 99900, offer_monthly_paise = 99900 where key = 'firm'`)
    }
  })
})

describe('the extra-client price: Rs 20 in 0755, Rs 50 a month (Rs 300 a year) from 0756', () => {
  const extra = async () => Number((await rows<J>(`select extra_client_monthly_paise as p from dpdp.plan where key = 'firm'`))[0].p)

  test('after 0755 and 0756 the Professional plan row holds 5000 paise, and nothing else about any plan moved', async () => {
    expect(await extra()).toBe(5000)
    const plans = await rows<J>(`select key, list_monthly_paise, offer_monthly_paise, included_clients, extra_client_monthly_paise, active from dpdp.plan order by key`)
    const by = Object.fromEntries(plans.map((p) => [p.key, p]))
    expect(by.firm).toMatchObject({ list_monthly_paise: 99900, offer_monthly_paise: 99900, included_clients: 10, extra_client_monthly_paise: 5000, active: true })
    expect(by.institution).toMatchObject({ list_monthly_paise: 99900, included_clients: 0, extra_client_monthly_paise: 0, active: true })
    for (const old of ['firm_free', 'firm_starter', 'firm_growth', 'firm_practice', 'firm_large']) expect(by[old]).toMatchObject({ active: false, extra_client_monthly_paise: 0 })
    const s = (await rows<J>(`select pack_price_paise, pack_days, pack_max_clients, yearly_months_charged from dpdp.billing_setting where id = 1`))[0]
    expect(s).toEqual({ pack_price_paise: 9900, pack_days: 90, pack_max_clients: 10, yearly_months_charged: 6 })
  })

  test('the plan list the screens read carries the new price (the same key the deployed screens already read)', async () => {
    const plans = await one<J[]>(`select public.dpdp_public_plans() as r`)
    expect(plans.find((p) => p.key === 'firm')).toMatchObject({ includedClients: 10, extraClientMonthlyPaise: 5000, yearlyMonthsCharged: 6 })
  })

  test('0756 moves only a price that still holds the old value: run again it changes nothing, and an owner edit made after it survives a re-run', async () => {
    await db.exec(read(F0756))
    expect(await extra()).toBe(5000)
    await db.query(`update dpdp.plan set extra_client_monthly_paise = 7000 where key = 'firm'`)
    try {
      await db.exec(read(F0756))
      expect(await extra()).toBe(7000)
    } finally {
      await db.query(`update dpdp.plan set extra_client_monthly_paise = 5000 where key = 'firm'`)
    }
  })

  test('on a database that still holds the 0755 value (2000), 0756 moves it to 5000 and stamps the change', async () => {
    await db.query(`update dpdp.plan set extra_client_monthly_paise = 2000, updated_at = '2000-01-01' where key = 'firm'`)
    try {
      await db.exec(read(F0756))
      const r = (await rows<J>(`select extra_client_monthly_paise as p, updated_at > '2020-01-01' as stamped from dpdp.plan where key = 'firm'`))[0]
      expect(r).toEqual({ p: 5000, stamped: true })
    } finally {
      await db.query(`update dpdp.plan set extra_client_monthly_paise = 5000 where key = 'firm'`)
    }
  })

  test('the roll-back file puts 2000 back (only while the row still holds 5000) and 0756 can be applied again after it', async () => {
    await db.exec(read(D0756))
    expect(await extra()).toBe(2000)
    await db.exec(read(D0756))
    expect(await extra()).toBe(2000)
    await db.exec(read(F0756))
    expect(await extra()).toBe(5000)
    await db.query(`update dpdp.plan set extra_client_monthly_paise = 7000 where key = 'firm'`)
    try {
      await db.exec(read(D0756))
      expect(await extra()).toBe(7000) // an owner edit is not undone by the roll-back
    } finally {
      await db.query(`update dpdp.plan set extra_client_monthly_paise = 5000 where key = 'firm'`)
    }
  })

  test('0756 changes data only: no function, no grant, no table; the function bodies come from 0755 untouched', () => {
    const sql = read(F0756).replace(/--[^\n]*/g, '')
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function|alter\s+table|drop\s|grant\s|revoke\s|security\s+definer/i)
    expect(sql).toMatch(/update\s+dpdp\.plan/i)
  })
})

describe('the trial pack: Rs 99 for 90 days, once, for an account that has paid nothing', () => {
  test('a new account is offered it, on both editions, with the price, days and client cap from the settings row', async () => {
    for (const kind of ['firm', 'institution'] as const) {
      const a = await openAccount(kind)
      await as(a.email)
      const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [a.orgId])
      expect(mine.money.pack, kind).toEqual({ available: true, pricePaise: 9900, days: 90, maxClients: 10, onPack: false })
    }
    const plans = await one<J[]>(`select public.dpdp_public_plans() as r`)
    expect(plans.map((p) => [p.key, p.packPricePaise, p.packDays, p.packMaxClients])).toEqual([['institution', 9900, 90, 10], ['firm', 9900, 90, 10]])
  })

  test('paying online: the pay door opens a Rs 99 attempt for "pack" (variation <plan>_pack) and refuses anything but pack, month or year', async () => {
    for (const kind of ['firm', 'institution'] as const) {
      const a = await openAccount(kind)
      await as(a.email)
      const p = await one<J>(`select public.dpdp_pay_begin('pack', $1, ${TICK}) as r`, [a.orgId])
      expect(p).toMatchObject({ amountPaise: 9900, interval: 'pack', variation: `${kind}_pack`, plan: kind })
      const row = (await rows<J>(`select "interval", amount_paise, product, variation from dpdp.payment_attempt where id = $1`, [p.attemptId]))[0]
      expect(row).toEqual({ interval: 'pack', amount_paise: 9900, product: 'veridian_dpdp', variation: `${kind}_pack` })
      await expect(db.query(`select public.dpdp_pay_begin('week', $1, ${TICK})`, [a.orgId])).rejects.toThrow(/Choose the trial pack, a month or a year/)
      await expect(db.query(`select public.dpdp_pay_begin('pack', $1)`, [a.orgId])).rejects.toThrow(/Please tick the box to continue/) // the Refund-policy tick is still required
    }
  })

  test('only the owner can pay for the organisation', async () => {
    const a = await openAccount('institution')
    await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2)`, [`i_st${a.orgId}`, `st${a.orgId}@price.test`])
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true)`, [`ie_st${a.orgId}`, `i_st${a.orgId}`, `st${a.orgId}@price.test`])
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ($1, $2, $3, 'staff', 'invited')`, [`m_st${a.orgId}`, `i_st${a.orgId}`, a.orgId])
    await as(`st${a.orgId}@price.test`)
    await expect(db.query(`select public.dpdp_pay_begin('pack', $1, ${TICK})`, [a.orgId])).rejects.toThrow(/Only the owner/)
  })

  test('a confirmed pack payment adds 90 days on top of the end of the trial (paid during the trial) or of today (after it lapsed); it sets pack_paid_at and NOT first_paid_at; the account is ACTIVE', async () => {
    const early = await openAccount('institution') // day 0: the free 30 days are not thrown away
    const r = await markPaid(early.orgId, 'pack')
    expect(r.ok).toBe(true)
    const a = await account(early.orgId)
    expect(a.pack_paid_at).not.toBeNull()
    expect(a.first_paid_at).toBeNull()
    expect(a.billing_interval).toBe('month') // a pack does not decide how it renews
    expect(await daysLeft(early.orgId)).toBeGreaterThan(30 + 90 - 2)
    expect(await daysLeft(early.orgId)).toBeLessThan(30 + 90 + 2)
    expect(await stateOf(early.orgId)).toBe('ACTIVE')
    const lapsed = await openAccount('institution')
    await setClock(lapsed.orgId, 100, null)
    expect(await stateOf(lapsed.orgId)).toBe('LOCKED')
    await markPaid(lapsed.orgId, 'pack')
    expect(await daysLeft(lapsed.orgId)).toBeGreaterThan(88)
    expect(await daysLeft(lapsed.orgId)).toBeLessThan(92)
    expect(await stateOf(lapsed.orgId)).toBe('ACTIVE') // a locked account that buys the pack is unlocked
    const pay = await rows<J>(`select plan, "interval", amount_paise from dpdp.payment where org_id = $1`, [lapsed.orgId])
    expect(pay).toEqual([{ plan: 'institution', interval: 'pack', amount_paise: 9900 }])
    const sub = (await rows<J>(`select state, "interval" from dpdp.subscription where org_id = $1`, [lapsed.orgId]))[0]
    expect(sub).toEqual({ state: 'active', interval: 'pack' })
  })

  test('it is once only: after a pack, and after any monthly or yearly payment, the pack is gone everywhere (account screen, pay door, claim, owner mark-paid)', async () => {
    const afterPack = await openAccount('firm')
    await markPaid(afterPack.orgId, 'pack')
    const afterMonth = await openAccount('institution')
    await markPaid(afterMonth.orgId, 'month')
    for (const a of [afterPack, afterMonth]) {
      await as(a.email)
      const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [a.orgId])
      expect(mine.money.pack.available).toBe(false)
      await expect(db.query(`select public.dpdp_pay_begin('pack', $1, ${TICK})`, [a.orgId])).rejects.toThrow(/only for an account that has not paid yet/)
      await expect(db.query(`select public.dpdp_declare_payment('pack', 9900, $1)`, [a.orgId])).rejects.toThrow(/only for an account that has not paid yet/)
      await expect(db.query(`select public.dpdp_owner_mark_paid($1, 'pack')`, [a.orgId])).rejects.toThrow(/Owner only/) // the account's own owner is not the platform owner
      await as('admin@veridian.test')
      await expect(db.query(`select public.dpdp_owner_mark_paid($1, 'pack')`, [a.orgId])).rejects.toThrow(/only for an account that has not paid yet/)
      // monthly and yearly stay available
      await as(a.email)
      expect((await one<J>(`select public.dpdp_pay_begin('year', $1, ${TICK}) as r`, [a.orgId])).interval).toBe('year')
    }
    expect((await account(afterPack.orgId)).pack_paid_at).not.toBeNull()
    await as(afterPack.email)
    expect((await one<J>(`select public.dpdp_my_account($1) as r`, [afterPack.orgId])).money.pack).toMatchObject({ available: false, onPack: true })
    await markPaid(afterPack.orgId, 'month')
    await as(afterPack.email)
    expect((await one<J>(`select public.dpdp_my_account($1) as r`, [afterPack.orgId])).money.pack).toMatchObject({ available: false, onPack: false }) // on a real plan now
  })

  test('a claim ("I have paid") for the pack is accepted while it is available, and recorded as an awaiting-confirmation claim, not a payment', async () => {
    const a = await openAccount('firm')
    await as(a.email)
    const r = await one<J>(`select public.dpdp_declare_payment('pack', 9900, $1, 'UTR99', null, null) as r`, [a.orgId])
    expect(r).toMatchObject({ ok: true, state: 'awaiting_confirmation' })
    expect((await rows<J>(`select self_declared_interval as i, self_declared_amount_paise as p from dpdp.subscription where org_id = $1`, [a.orgId]))[0]).toEqual({ i: 'pack', p: 9900 })
    expect((await rows(`select 1 from dpdp.payment where org_id = $1`, [a.orgId])).length).toBe(0)
  })

  test('during a pack the account clock still runs the normal way: ACTIVE to the end of the 90 days, then DUE, GRACE, LOCKED like any lapsed account', async () => {
    const a = await openAccount('institution')
    await markPaid(a.orgId, 'pack')
    await setClock(a.orgId, 400, -0.5) // the paid period ended half a day ago
    expect(await stateOf(a.orgId)).toBe('DUE')
    await setClock(a.orgId, 400, -3)
    expect(await stateOf(a.orgId)).toBe('GRACE')
    await setClock(a.orgId, 400, -9)
    expect(await stateOf(a.orgId)).toBe('LOCKED')
  })

  test('the pack earns the REFERRER nothing; the first monthly payment after it earns the usual 5% (the rule looks past an earlier pack)', async () => {
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_ref9', 'ref9@price.test') on conflict do nothing`)
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_ref9', 'i_ref9', 'ref9@price.test', true) on conflict do nothing`)
    await db.query(`insert into dpdp.referral (identity_id, code) values ('i_ref9', 'REFNINE') on conflict do nothing`)
    const a = await openAccount('institution')
    await db.query(`insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ($1, 'i_ref9', $2, 'signed_up')`, [`re_${a.orgId}`, a.orgId])
    await markPaid(a.orgId, 'pack')
    expect((await rows(`select 1 from dpdp.referral_commission where referrer_identity_id = 'i_ref9'`)).length).toBe(0)
    await markPaid(a.orgId, 'month')
    const c = await rows<J>(`select basis, amount_paise from dpdp.referral_commission where referrer_identity_id = 'i_ref9'`)
    expect(c).toEqual([{ basis: 'first_month', amount_paise: 4995 }]) // 5% of Rs 999
  })

  test('the settings row can change the pack (price, days, cap) without a new migration; a zero or absurd value is refused by the table', async () => {
    await expect(db.query(`update dpdp.billing_setting set pack_price_paise = 0`)).rejects.toThrow()
    await expect(db.query(`update dpdp.billing_setting set pack_days = 0`)).rejects.toThrow()
    await expect(db.query(`update dpdp.billing_setting set pack_max_clients = -1`)).rejects.toThrow()
    await db.query(`update dpdp.billing_setting set pack_price_paise = 14900, pack_days = 60 where id = 1`)
    try {
      const a = await openAccount('institution')
      await as(a.email)
      expect((await one<J>(`select public.dpdp_pay_begin('pack', $1, ${TICK}) as r`, [a.orgId])).amountPaise).toBe(14900)
    } finally {
      await db.query(`update dpdp.billing_setting set pack_price_paise = 9900, pack_days = 90 where id = 1`)
    }
  })
})

describe('commission: monthly and yearly payments only, and the client cap follows the first of those', () => {
  const addPartner = async (key: string, code: string) => {
    const identity = `i_pp_${key}`
    await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2)`, [identity, `${key}@pp.test`])
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true)`, [`ie_pp_${key}`, identity, `${key}@pp.test`])
    await db.query(`insert into dpdp.sales_partner (identity_id, status) values ($1, 'active')`, [identity])
    await db.query(`insert into dpdp.referral (identity_id, code) values ($1, $2)`, [identity, code])
    return identity
  }

  test('a partner-attributed account: pack Rs 99 earns nothing; then a Rs 5,994 year earns 50% of the year', async () => {
    const partner = await addPartner('k1', 'PPK00001')
    await as('pk1@price.test')
    const r = await one<J>(`select public.dpdp_open_account('institution', 'Partnered', null, null, null, 'PPK00001', null, null, null, ${TICK}) as r`)
    expect((await account(r.orgId)).attributed_identity_id).toBe(partner)
    await markPaid(r.orgId, 'pack')
    expect((await rows(`select 1 from dpdp.account_commission where org_id = $1`, [r.orgId])).length).toBe(0)
    await markPaid(r.orgId, 'year')
    expect(await rows<J>(`select base_paise, amount_paise from dpdp.account_commission where org_id = $1`, [r.orgId])).toEqual([{ base_paise: 599_400, amount_paise: 299_700 }])
    // the 12 months run from the first MONTHLY or YEARLY payment, not from the pack
    expect((await account(r.orgId)).first_paid_at).not.toBeNull()
  })

  test('the cap of ten clients is a trial rule: an Organisation has none to add, a firm has 10 until its first monthly or yearly payment and none after', async () => {
    const cap = async (orgId: string) => ((await rows<J>(`select dpdp.account_client_cap(a) as c from dpdp.account a where a.org_id = $1`, [orgId]))[0].c as number | null)
    const o = await openAccount('institution')
    expect(await cap(o.orgId)).toBe(0)
    const f = await openAccount('firm')
    expect(await cap(f.orgId)).toBe(10)
    await markPaid(f.orgId, 'pack')
    expect(await cap(f.orgId)).toBe(10)
    await markPaid(f.orgId, 'year')
    expect(await cap(f.orgId)).toBeNull()
  })
})

describe('nobody is free, and the legacy flat price for an organisation with no account', () => {
  test('dpdp.account_is_free is false for every account, whatever it says about itself', async () => {
    const f = await openAccount('firm')
    await db.query(`update dpdp.account set verification_status = 'declared' where org_id = $1`, [f.orgId])
    expect(((await rows<J>(`select dpdp.account_is_free(a) as f from dpdp.account a where a.org_id = $1`, [f.orgId]))[0].f)).toBe(false)
    await setClock(f.orgId, 90, null)
    expect(await stateOf(f.orgId)).toBe('LOCKED')
  })

  test('an organisation with no account row (made before billing) can still pay online, YEARLY ONLY, at the plan table\'s half-price year (Rs 5,994, no longer a typed Rs 9,999); month and pack are refused', async () => {
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_legacy', 'legacy@price.test')`)
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_legacy', 'i_legacy', 'legacy@price.test', true)`)
    await db.query(`insert into dpdp.organisation (id, name, slug, product) values ('o_legacy', 'Legacy', 'o_legacy', 'institution')`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_legacy', 'i_legacy', 'o_legacy', 'owner', 'created')`)
    await as('legacy@price.test')
    expect(await stateOf('o_legacy')).toBe('ACTIVE') // not billed until the owner decides (see the pull request)
    const y = await one<J>(`select public.dpdp_pay_begin('year', 'o_legacy', ${TICK}) as r`)
    expect([y.amountPaise, y.variation]).toEqual([599_400, 'institution_year'])
    // the reminder e-mails quote the same numbers (dpdp_billing_prices), so they cannot disagree with the screen
    expect(await one<J>(`select public.dpdp_billing_prices() as r`)).toEqual({ currency: 'INR', yearPaise: 599_400, monthPaise: 99_900, packPaise: 9_900 })
    await expect(db.query(`select public.dpdp_pay_begin('month', 'o_legacy', ${TICK})`)).rejects.toThrow(/yearly plan/)
    await expect(db.query(`select public.dpdp_pay_begin('pack', 'o_legacy', ${TICK})`)).rejects.toThrow(/yearly plan/)
    const mine = await one<J>(`select public.dpdp_my_account('o_legacy') as r`)
    expect(mine).toEqual({ orgId: 'o_legacy', hasAccount: false, state: 'ACTIVE' })
  })
})

describe('the sign-up trap: an organisation made through dpdp_create_my_org alone now gets its account, so it is billed', () => {
  const create = (email: string, name: string, product: string, tick = true) =>
    as(email).then(() => one<J>(`select public.dpdp_create_my_org($1, $2, null, ${tick ? TICK : 'null, false'}) as r`, [name, product]))

  test('an institution created that way has an account on the Organisation plan at Rs 999, a 30-day trial, and one "account_opened" event', async () => {
    const r = await create('plain1@price.test', 'Plain one', 'institution')
    const a = await account(r.orgId)
    expect(a).toMatchObject({ account_type: 'institution', plan_key: 'institution', locked_monthly_paise: 99_900, paid_until: null, pack_paid_at: null, first_paid_at: null })
    expect(await stateOf(r.orgId)).toBe('TRIAL')
    expect((await rows(`select 1 from dpdp.event where org_id = $1 and kind = 'account_opened'`, [r.orgId])).length).toBe(1)
    await setClock(r.orgId, 100, null)
    expect(await stateOf(r.orgId)).toBe('LOCKED') // it is billed: the 30 days run out
  })

  test('a firm created that way is on the Professional plan', async () => {
    const r = await create('plain2@price.test', 'Plain two', 'firm')
    expect(await account(r.orgId)).toMatchObject({ account_type: 'firm', plan_key: 'firm', locked_monthly_paise: 99_900 })
  })

  test('a repeat call (double click) makes no second account and no second event', async () => {
    const before = (await rows(`select count(*)::int as c from dpdp.account`))[0].c
    const r = await create('plain3@price.test', 'Plain three', 'institution')
    expect((await rows(`select count(*)::int as c from dpdp.account`))[0].c).toBe(before + 1)
    // the same call again; the stand-in always makes a new organisation, so call the account maker directly for the repeat
    expect((await rows<J>(`select dpdp.ensure_account($1, 'institution') as made`, [r.orgId]))[0].made).toBe(false)
    expect((await rows(`select 1 from dpdp.event where org_id = $1 and kind = 'account_opened'`, [r.orgId])).length).toBe(1)
  })

  test('the app\'s own door, dpdp_open_account, still makes exactly ONE account (with its source and price), not two', async () => {
    const o = await openAccount('institution')
    expect((await rows(`select 1 from dpdp.account where org_id = $1`, [o.orgId])).length).toBe(1)
    expect((await rows(`select 1 from dpdp.event where org_id = $1 and kind = 'account_opened'`, [o.orgId])).length).toBe(1)
  })

  test('nothing is changed for organisations that already exist: the function only touches the organisation it creates', async () => {
    const before = (await rows<J>(`select count(*)::int as c from dpdp.account`))[0].c
    await db.exec(read(F0755)) // re-running the migration does not invent accounts for organisations that have none
    expect((await rows<J>(`select count(*)::int as c from dpdp.account`))[0].c).toBe(before)
    expect((await rows(`select 1 from dpdp.account where org_id = 'o_legacy'`)).length).toBe(0)
  })

  test('the Terms tick is still required on that door (0748 is untouched)', async () => {
    await as('notick@price.test')
    await expect(db.query(`select public.dpdp_create_my_org('No tick', 'institution')`)).rejects.toThrow(/Please tick the box to continue/)
  })
})
