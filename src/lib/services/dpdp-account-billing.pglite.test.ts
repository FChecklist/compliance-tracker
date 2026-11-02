/// <reference types="bun-types" />
// DPDP account opening, plans, the declaration and the billing state machine (drizzle/0734_dpdp_account_opening_plans_billing.sql) AS THEY ARE
// AFTER the new pricing (drizzle/0755: a Rs 99 three-month trial pack, Rs 999 a month with yearly at half price, and Rs 20 a month per client beyond
// ten for a Professional). The new price rules themselves are pinned in dpdp-pricing-pack.pglite.test.ts; this file keeps the state machine, the
// lock, mark-paid, the partner commission and the e-mail worklist honest on the post-0755 database.
// Offline proof on PGlite (real Postgres as WASM): the live database is never touched. The WHOLE migration files are executed (0734, 0735, 0748, 0755),
// not copies of their functions, on top of stand-in base tables. The older functions they build on (caller identity/membership, the event writer, the
// money function, the owner check, the partner notice) are copied out of their own migration files at run time, so a change to them is seen here.
//
// Four things are stand-ins and say so: dpdp_create_my_org and the original dpdp_create_client_org (their own tests live elsewhere; here they
// create just enough and record the referral code they were handed), the three money RPCs' originals (they call the gate, which is what the
// allow flag has to get past), and dpdp.payment_attempt (only the columns the pay RPC writes).
//
// What this pins: the state machine at every boundary and against the browser's copy (dpdp-app/src/lib/billing-state.ts); the plan price an
// account signs up at and keeps (offer window, partner code, no price below the offer without the owner); the client cap; the practitioner
// declaration (a record only: nobody is free); the lock (working screens and the AI link refuse, the always-open actions work, a payment
// unlocks); the partner commission (50% of the price actually paid, first 12 months, never on the pack); the billing e-mail worklist (opt-outs,
// weekly, final download); and that none of the events this flow writes carries an e-mail address.
//
// Run: bun test --isolate src/lib/services/dpdp-account-billing.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, read } from './dpdp-pglite-base'
import { billingState, dueLine, finalDownloadDue, periodEnd, DEFAULT_BILLING_SETTINGS } from '../../../dpdp-app/src/lib/billing-state'

const F0733 = 'drizzle/0733_dpdp_visitor_journey.sql'
const F0734 = 'drizzle/0734_dpdp_account_opening_plans_billing.sql'
const F0735 = 'drizzle/0735_dpdp_test_live_mode_profile_capture.sql'
const F0748 = 'drizzle/0748_dpdp_terms_acceptance.sql'
const F0755 = 'drizzle/0755_dpdp_pricing_trial_pack_and_per_client.sql'
/** The two ticks the live sign-up and pay doors now demand (0748). */
const TICK = `dpdp.terms_current_version(), true`
/** dpdp.payment_attempt as 0673 + 0747 leave it, cut down to the columns the pay RPC writes (the interval check is the one 0755 widens). */
const PAYMENT_ATTEMPT_SQL = `create table dpdp.payment_attempt (
  id text primary key, org_id text not null references dpdp.organisation (id), plan text not null check (plan in ('firm', 'institution')),
  "interval" text not null constraint payment_attempt_interval_check check ("interval" in ('month', 'year')), amount_paise integer not null check (amount_paise > 0),
  created_by_identity_id text, product text, variation text, status text not null default 'created',
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
)`

let db: PGlite
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(email ? { email } : {})])
type J = Record<string, any>
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
const DAY = 86_400_000
const ago = (days: number) => iso(new Date(Date.now() - days * DAY))
let n = 0
/**
 * The festive-offer MECHANICS (0734) still work and are still tested, on a fixture: list Rs 801, offer Rs 399. The real plan row after 0755 is Rs 999 with
 * no offer. festiveOffer starts the fixture, endOffer lets its window lapse (new sign-ups pay the fixture's list price), restoreOffer puts the real row back.
 */
const festiveOffer = () => db.query(`update dpdp.plan set list_monthly_paise = 80100, offer_monthly_paise = 39900, offer_starts_on = date '2026-10-06', offer_ends_on = date '2099-12-31' where key = 'institution'`)
const endOffer = () => db.query(`update dpdp.plan set list_monthly_paise = 80100, offer_monthly_paise = 39900, offer_starts_on = date '2020-01-01', offer_ends_on = current_date - 1 where key = 'institution'`)
const restoreOffer = () => db.query(`update dpdp.plan set list_monthly_paise = 99900, offer_monthly_paise = 99900, offer_starts_on = null, offer_ends_on = null where key = 'institution'`)

/** A fresh owner (identity, e-mail) with an account opened through the real dpdp_open_account. Returns the org id. */
async function openAccount(kind: 'firm' | 'institution', extra: Partial<{ body: string; reg: string; ref: string; sp: string; tag: string; seen: string; billing: string }> = {}) {
  const email = `owner${++n}@acct.test`
  await as(email)
  const r = await one<J>(`select public.dpdp_open_account($1, $2, $3, $4, $5, $6, $7, $8, $9, ${TICK}) as r`, [kind, `Org ${n}`, extra.body ?? null, extra.reg ?? null, extra.ref ?? null, extra.sp ?? null, extra.tag ?? null, extra.seen ?? null, extra.billing ?? null])
  return { email, orgId: r.orgId as string, r }
}
const account = async (orgId: string) => (await rows<J>(`select * from dpdp.account where org_id = $1`, [orgId]))[0]
const setClock = (orgId: string, openedDaysAgo: number, paidUntilDaysFromNow: number | null) =>
  db.query(`update dpdp.account set opened_at = $2, paid_until = $3 where org_id = $1`, [orgId, ago(openedDaysAgo), paidUntilDaysFromNow === null ? null : ago(-paidUntilDaysFromNow)])
const stateOf = async (orgId: string) => (await one<J>(`select dpdp.org_billing_state($1) as r`, [orgId])) as unknown as string
const addPartner = async (key: string, code: string) => {
  const identity = `i_partner_${key}`
  await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2)`, [identity, `${key}@partner.test`])
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true)`, [`ie_${key}`, identity, `${key}@partner.test`])
  await db.query(`insert into dpdp.sales_partner (identity_id, status) values ($1, 'active')`, [identity])
  await db.query(`insert into dpdp.referral (identity_id, code) values ($1, $2)`, [identity, code])
  return identity
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  await db.exec(read(F0733))
  await db.exec(read(F0734))
  await db.exec(read(F0735))
  await db.exec(read(F0748))
  await db.exec(PAYMENT_ATTEMPT_SQL)
  await db.exec(read(F0755))
  await db.query(`insert into dpdp.platform_admin (email) values ('admin@veridian.test')`)
  await db.query(`insert into dpdp.identity (id, primary_email) values ('i_admin', 'admin@veridian.test')`)
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_admin', 'i_admin', 'admin@veridian.test', true)`)
}, 180_000)

describe('the migration files themselves', () => {
  test('0755 runs a second time without error and leaves the prices where the owner set them (it only moves a price that still holds the old value)', async () => {
    // (0734 is not re-run here on purpose: after 0748 renamed its sign-up function away, running it again would put the old name back.)
    await db.exec(read(F0755))
    expect((await rows(`select to_regprocedure('public.dpdp__my_billing_core(text)') is not null as ok`))[0].ok).toBe(true)
    expect((await rows(`select to_regprocedure('public.dpdp__create_client_org_core(text, text, text)') is not null as ok`))[0].ok).toBe(true)
    // the wrapper is still the public name (a re-run did not rename it onto the core)
    expect((await rows(`select prosrc like '%allow_locked%' as ok from pg_proc where proname = 'dpdp_my_billing'`))[0].ok).toBe(true)
    const p = await rows<J>(`select key, list_monthly_paise, active from dpdp.plan where key in ('institution', 'firm') order by key`)
    expect(p).toEqual([{ key: 'firm', list_monthly_paise: 99900, active: true }, { key: 'institution', list_monthly_paise: 99900, active: true }])
    expect((await rows<J>(`select yearly_months_charged as y from dpdp.billing_setting`))[0].y).toBe(6)
  })

  test('the plans after 0755: one Professional plan (Rs 999, ten clients included, Rs 20 each beyond), one Organisation plan (Rs 999); the old tiers and the free plan are off but not deleted', async () => {
    const plans = await rows<J>(`select key, account_type, name, active, list_monthly_paise, offer_monthly_paise, included_clients, extra_client_monthly_paise, requires_verified from dpdp.plan order by sort_order`)
    expect(plans.filter((p) => p.active).map((p) => [p.key, p.account_type, p.name, p.list_monthly_paise, p.offer_monthly_paise, p.included_clients, p.extra_client_monthly_paise])).toEqual([
      ['institution', 'institution', 'Organisation', 99900, 99900, 0, 0],
      ['firm', 'firm', 'Professional', 99900, 99900, 10, 2000],
    ])
    expect(plans.filter((p) => !p.active).map((p) => p.key)).toEqual(['firm_free', 'firm_starter', 'firm_growth', 'firm_practice', 'firm_large'])
    const s = (await rows<J>(`select * from dpdp.billing_setting`))[0]
    expect([s.trial_days, s.due_days, s.grace_days, s.yearly_months_charged, Number(s.commission_percent), s.commission_months, s.attribution_window_days, s.pack_price_paise, s.pack_days, s.pack_max_clients])
      .toEqual([30, 1, 7, 6, 50, 12, 30, 9900, 90, 10])
  })

  test('the plans are public: dpdp_public_plans answers anon with the two live plans, the new keys beside the old ones, never "discount applied"', async () => {
    const plans = await one<J[]>(`select public.dpdp_public_plans() as r`)
    expect(plans.map((p) => p.key)).toEqual(['institution', 'firm'])
    const inst = plans.find((p) => p.key === 'institution')!
    expect(inst).toMatchObject({ monthlyPaise: 99900, listMonthlyPaise: 99900, offerLabel: null, yearlyMonthsCharged: 6, packPricePaise: 9900, packDays: 90, packMaxClients: 10 })
    const firm = plans.find((p) => p.key === 'firm')!
    expect(firm).toMatchObject({ monthlyPaise: 99900, includedClients: 10, extraClientMonthlyPaise: 2000, maxClients: 10 })
    expect(JSON.stringify(plans).toLowerCase()).not.toContain('discount')
    expect(plans.some((p) => p.key === 'firm_free')).toBe(false)
  })
})

describe('the state machine, at every boundary', () => {
  const calc = async (free: boolean, opened: string, paid: string | null, now: string) =>
    (await one<string>(`select dpdp.billing_state_calc($1, $2::timestamp, $3::timestamp, $4::timestamp, 30, 1, 7) as r`, [free, opened, paid, now])) as unknown as string
  const O = '2026-01-01 00:00:00' // opened; the trial ends at 2026-01-31 00:00:00 (E)

  test('TRIAL until the trial ends, DUE from the instant it ends, GRACE after the due day, LOCKED after the grace', async () => {
    expect(await calc(false, O, null, '2026-01-01 00:00:00')).toBe('TRIAL')
    expect(await calc(false, O, null, '2026-01-30 23:59:59')).toBe('TRIAL')
    expect(await calc(false, O, null, '2026-01-31 00:00:00')).toBe('DUE') // day 31
    expect(await calc(false, O, null, '2026-01-31 23:59:59')).toBe('DUE')
    expect(await calc(false, O, null, '2026-02-01 00:00:00')).toBe('GRACE')
    expect(await calc(false, O, null, '2026-02-07 23:59:59')).toBe('GRACE')
    expect(await calc(false, O, null, '2026-02-08 00:00:00')).toBe('LOCKED') // 7 days after the due day
    expect(await calc(false, O, null, '2027-01-01 00:00:00')).toBe('LOCKED')
  })

  test('paid: ACTIVE up to paid-until, then the same DUE / GRACE / LOCKED run from that date', async () => {
    const P = '2026-03-15 12:00:00'
    expect(await calc(false, O, P, '2026-02-10 00:00:00')).toBe('ACTIVE') // well past the trial: paid covers it
    expect(await calc(false, O, P, '2026-03-15 11:59:59')).toBe('ACTIVE')
    expect(await calc(false, O, P, '2026-03-15 12:00:00')).toBe('DUE')
    expect(await calc(false, O, P, '2026-03-16 12:00:00')).toBe('GRACE')
    expect(await calc(false, O, P, '2026-03-23 12:00:00')).toBe('LOCKED')
  })

  test('a paid-until date BEFORE the trial end never shortens the trial', async () => {
    expect(await calc(false, O, '2026-01-10 00:00:00', '2026-01-20 00:00:00')).toBe('ACTIVE')
    expect(await calc(false, O, '2026-01-10 00:00:00', '2026-01-31 00:00:00')).toBe('DUE')
  })

  test('a free verified firm is ACTIVE at any time, for ever', async () => {
    for (const now of ['2026-01-01 00:00:00', '2026-02-20 00:00:00', '2040-01-01 00:00:00']) expect(await calc(true, O, null, now)).toBe('ACTIVE')
  })

  test("the browser's copy of the rules (billing-state.ts) gives the same answer as the database across 400 instants around every edge", async () => {
    const opened = new Date('2026-01-01T00:00:00Z')
    const paidUntils: Array<Date | null> = [null, new Date('2026-03-15T12:00:00Z'), new Date('2026-01-10T00:00:00Z')]
    const edges = [0, 30, 31, 32, 38, 39, 40, 45, 75, 76, 120]
    for (const p of paidUntils) {
      const e = periodEnd(opened, p)
      const probes: Date[] = []
      for (const days of edges) for (const delta of [-1000, 0, 1000]) probes.push(new Date(opened.getTime() + days * DAY + delta))
      for (const k of [-8, -1, 0, 1, 7, 8, 9]) for (const delta of [-1000, 0, 1000]) probes.push(new Date(e.getTime() + k * DAY + delta))
      for (const now of probes) {
        const sqlState = await calc(false, iso(opened), p ? iso(p) : null, iso(now))
        expect(billingState({ openedAt: opened, paidUntil: p, now }), `${now.toISOString()} paid=${p?.toISOString()}`).toBe(sqlState as never)
      }
    }
    expect(finalDownloadDue({ openedAt: opened, paidUntil: null, now: new Date(opened.getTime() + (30 + 89) * DAY) })).toBe(false)
    expect(finalDownloadDue({ openedAt: opened, paidUntil: null, now: new Date(opened.getTime() + (30 + 90) * DAY) })).toBe(true)
    expect(DEFAULT_BILLING_SETTINGS.graceDays).toBe(7)
  })

  test('the calm line is the same sentence in the database and in the browser, and only DUE / GRACE / LOCKED have one', async () => {
    for (const s of ['TRIAL', 'ACTIVE', 'DUE', 'GRACE', 'LOCKED'] as const) {
      const sqlLine = await one<string | null>(`select dpdp.billing_due_line($1) as r`, [s])
      expect(dueLine(s), s).toBe(sqlLine as never)
    }
    expect(dueLine('LOCKED')).toContain('record a breach, answer a grievance or honour a consent withdrawal')
  })
})

describe('opening an account', () => {
  test('an institution: owner membership, the account row, the Rs 999 price locked in, nothing paid, no payment row', async () => {
    const { orgId, r } = await openAccount('institution')
    expect(r).toMatchObject({ ok: true, accountType: 'institution', planKey: 'institution', monthlyPaise: 99900, listMonthlyPaise: 99900, offerActive: false, attribution: 'none', verification: 'none' })
    const a = await account(orgId)
    expect(a).toMatchObject({ account_type: 'institution', plan_key: 'institution', locked_monthly_paise: 99900, verification_status: 'none', paid_until: null, pack_paid_at: null, first_paid_at: null })
    expect((await rows(`select 1 from dpdp.payment where org_id = $1`, [orgId])).length).toBe(0)
    expect(await stateOf(orgId)).toBe('TRIAL')
  })

  test('a firm opens on the one Professional plan at Rs 999 (ten clients included), NOT free, whatever it says about itself', async () => {
    const { orgId, r } = await openAccount('firm')
    expect(r.planKey).toBe('firm')
    expect((await account(orgId)).locked_monthly_paise).toBe(99900)
  })

  test('opening an account without ticking the Terms box is refused (0748), and nothing is created', async () => {
    await as('untick@acct.test')
    const before = (await rows(`select count(*)::int as c from dpdp.account`))[0].c
    await expect(db.query(`select public.dpdp_open_account('institution', 'No tick')`)).rejects.toThrow(/Please tick the box to continue/)
    expect((await rows(`select count(*)::int as c from dpdp.account`))[0].c).toBe(before)
  })

  test('professional details at opening are optional and never block: stored when they fit, left out when they do not, never "pending", never an event about checking', async () => {
    const { orgId, r } = await openAccount('firm', { body: 'ICAI', reg: '123456/W100' })
    expect(r.verification).toBe('none')
    expect(await account(orgId)).toMatchObject({ professional_body: 'ICAI', registration_no: '123456/W100', verification_status: 'none' })
    await as('bad@acct.test')
    for (const args of ["'ICAI', null", "'BAR', '123456'", "'ICSI', 'a;drop table'"] as const) {
      const out = await one<J>(`select public.dpdp_open_account('firm', 'X', ${args}, p_terms_version => dpdp.terms_current_version(), p_terms_accepted => true) as r`)
      expect(out.ok).toBe(true)
      await db.query(`delete from dpdp.account where org_id = $1`, [out.orgId])
      await db.query(`delete from dpdp.membership where org_id = $1`, [out.orgId])
      await db.query(`delete from dpdp.subscription where org_id = $1`, [out.orgId])
      await db.query(`delete from dpdp.referral_event where referred_org_id = $1`, [out.orgId])
      await db.query(`delete from dpdp.organisation where id = $1`, [out.orgId])
    }
    const inst = await openAccount('institution', { body: 'ICSI', reg: '123456' })
    expect(await account(inst.orgId)).toMatchObject({ professional_body: null, registration_no: null })
    await as('bad2@acct.test')
    await expect(db.query(`select public.dpdp_open_account('hospital', 'X', p_terms_version => dpdp.terms_current_version(), p_terms_accepted => true)`)).rejects.toThrow(/Choose whether/)
  })

  test('the offer MECHANICS (a fixture of Rs 801 list, Rs 399 offer): once the window has ended a NEW sign-up pays the list price; an earlier account keeps what it signed up at', async () => {
    try {
      await festiveOffer()
      const early = await openAccount('institution')
      expect(early.r).toMatchObject({ monthlyPaise: 39900, listMonthlyPaise: 80100, offerActive: true })
      await endOffer()
      const late = await openAccount('institution')
      expect((await account(late.orgId)).locked_monthly_paise).toBe(80100)
      expect(late.r.offerActive).toBe(false)
      expect((await account(early.orgId)).locked_monthly_paise).toBe(39900)
      await as(early.email)
      const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [early.orgId])
      expect(mine.money.monthlyPaise).toBe(39900) // what the account shows the owner is what it signed up at, not today's list price
    } finally {
      await restoreOffer()
    }
  })

  test('the yearly price is six months (half price) of the monthly price actually signed up at, and the monthly is shown beside it', async () => {
    const { email, orgId } = await openAccount('institution')
    await as(email)
    const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [orgId])
    expect(mine.money).toMatchObject({ monthPaise: 99900, yearPaise: 599400, monthlyPaise: 99900, offerLabel: null, yearlyMonthsCharged: 6 })
  })

  test('an offer fixture still shows its wording on the account: "Festive offer: 50% off", never "discount applied"', async () => {
    try {
      await festiveOffer()
      const { email, orgId } = await openAccount('institution')
      await as(email)
      const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [orgId])
      expect(mine.money).toMatchObject({ monthPaise: 39900, yearPaise: 239400, offerLabel: 'Festive offer: 50% off' })
      expect(JSON.stringify(mine).toLowerCase()).not.toContain('discount')
    } finally {
      await restoreOffer()
    }
  })

  test('a double click returns the same account and does not open a second one', async () => {
    const { email, orgId } = await openAccount('institution')
    await as(email)
    const before = (await rows(`select count(*)::int as c from dpdp.account`))[0].c
    // the stand-in sign-up never answers "existing"; make it do so for this one call, as the real function does for a repeat within 10 minutes
    // (after 0748 the stand-in lives under the core's name; the public dpdp_create_my_org is the wrapper that checks the tick)
    const stub = BASE_SQL.match(/create function public\.dpdp_create_my_org[\s\S]*?end \$f\$;/)![0].replace('create function public.dpdp_create_my_org', 'create or replace function public.dpdp__create_my_org_core')
    try {
      await db.query(`create or replace function public.dpdp__create_my_org_core(p_name text, p_product text, p_referral_code text default null) returns jsonb language sql as $f$ select jsonb_build_object('ok', true, 'orgId', '${orgId}', 'existing', true) $f$`)
      const again = await one<J>(`select public.dpdp_open_account('institution', 'Org', null, null, null, null, null, null, null, ${TICK}) as r`)
      expect(again.accountExisting).toBe(true)
      expect((await rows(`select count(*)::int as c from dpdp.account`))[0].c).toBe(before)
    } finally {
      await db.exec(stub) // the other tests need the ordinary stand-in back
    }
  })
})

describe('where the sale came from (attribution) and the partner code', () => {
  test('a partner outranks a referral; the referral code is then NOT passed on (it would earn twice)', async () => {
    const partner = await addPartner('p1', 'PARTNER1')
    await addPartner('r1', 'REFERRAL1') // a plain referrer
    await db.query(`delete from public.t_my_org_calls`)
    await db.query(`update dpdp.sales_partner set status = 'active' where identity_id = $1`, [partner])
    const { orgId, r } = await openAccount('institution', { ref: 'REFERRAL1', sp: 'PARTNER1' })
    expect(r.attribution).toBe('partner')
    expect(await account(orgId)).toMatchObject({ source_kind: 'partner', attributed_identity_id: partner })
    expect((await rows<J>(`select ref from public.t_my_org_calls`)).map((x) => x.ref)).toEqual([null])
  })

  test('a referral alone is recorded as a referral and its code goes through to the sign-up (the existing referral machinery)', async () => {
    const referrer = await addPartner('r2', 'REFERRAL2')
    await db.query(`update dpdp.sales_partner set status = 'ended' where identity_id = $1`, [referrer]) // a plain member, not an active partner
    await db.query(`delete from public.t_my_org_calls`)
    const { orgId, r } = await openAccount('firm', { ref: 'referral2' })
    expect(r.attribution).toBe('referral')
    expect(await account(orgId)).toMatchObject({ source_kind: 'referral', attributed_identity_id: referrer })
    expect((await rows<J>(`select ref from public.t_my_org_calls`)).map((x) => x.ref)).toEqual(['referral2'])
  })

  test('only a campaign tag: kept as the source, nobody earns', async () => {
    const { orgId, r } = await openAccount('institution', { tag: 'vid.abc123def456' })
    expect(r.attribution).toBe('tracker')
    expect(await account(orgId)).toMatchObject({ source_kind: 'tracker', source_tag: 'vid.abc123def456', attributed_identity_id: null })
  })

  test('a tag that is not a tag is dropped quietly; the sign-up still works', async () => {
    const { orgId } = await openAccount('institution', { tag: 'Robert"); drop table x;--' })
    expect(await account(orgId)).toMatchObject({ source_kind: 'none', source_tag: null })
  })

  test('the 30-day window: a first touch older than that is ignored (a code, a tag, everything)', async () => {
    await addPartner('p2', 'PARTNER2')
    const old = await openAccount('institution', { sp: 'PARTNER2', tag: 'wa-campaign', seen: new Date(Date.now() - 31 * DAY).toISOString() })
    expect(await account(old.orgId)).toMatchObject({ source_kind: 'none', source_tag: null, attributed_identity_id: null })
    const fresh = await openAccount('institution', { sp: 'PARTNER2', seen: new Date(Date.now() - 29 * DAY).toISOString() })
    expect((await account(fresh.orgId)).source_kind).toBe('partner')
  })

  test('nobody earns on their own account: a partner opening an account with their own code gets no attribution', async () => {
    const partner = await addPartner('p3', 'PARTNER3')
    await as('p3@partner.test')
    const r = await one<J>(`select public.dpdp_open_account('institution', 'Own', null, null, null, 'PARTNER3', p_terms_version => dpdp.terms_current_version(), p_terms_accepted => true) as r`)
    expect((await account(r.orgId)).attributed_identity_id).toBeNull()
    expect(partner).toBeTruthy()
  })

  test('a partner code applies the plan price and tags the sale; it never goes below it without the Owner (extra percent needs approval)', async () => {
    const partner = await addPartner('p4', 'PARTNER4')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_set_partner_code($1, 'FEST4', 0, true)`, [partner])
    const plain = await openAccount('institution', { sp: 'FEST4' })
    expect((await account(plain.orgId)).locked_monthly_paise).toBe(99900) // exactly the plan price, no lower
    expect(await account(plain.orgId)).toMatchObject({ source_kind: 'partner', partner_code: 'FEST4', attributed_identity_id: partner })
    // the table itself refuses an extra percentage that nobody approved
    await expect(db.query(`insert into dpdp.partner_offer_code (code, partner_identity_id, extra_percent_off) values ('SNEAK4', $1, 10)`, [partner])).rejects.toThrow()
    // a non-owner cannot set a code at all
    await as('p4@partner.test')
    await expect(db.query(`select public.dpdp_owner_set_partner_code($1, 'MINE44', 90, true)`, [partner])).rejects.toThrow(/Owner only/)
    // the Owner approves 10% more: that code, and only that code, goes below the offer
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_set_partner_code($1, 'FEST4', 10, true)`, [partner])
    const approved = await openAccount('institution', { sp: 'FEST4' })
    expect((await account(approved.orgId)).locked_monthly_paise).toBe(Math.round(99900 * 0.9))
    const other = await openAccount('institution')
    expect((await account(other.orgId)).locked_monthly_paise).toBe(99900)
  })

  test('a partner code that is not active, or whose partner is not active, is ignored (the sign-up still works, at the plan price)', async () => {
    const partner = await addPartner('p5', 'PARTNER5')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_set_partner_code($1, 'OFF555', 0, false)`, [partner])
    const a = await openAccount('institution', { sp: 'OFF555' })
    expect((await account(a.orgId)).source_kind).toBe('none')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_set_partner_code($1, 'ON5555', 0, true)`, [partner])
    await db.query(`update dpdp.sales_partner set status = 'paused' where identity_id = $1`, [partner])
    const b = await openAccount('institution', { sp: 'ON5555' })
    expect((await account(b.orgId)).source_kind).toBe('none')
  })

  test('the partner is told "a firm signed up" without the buyer: the notice carries the edition only', async () => {
    const partner = await addPartner('p6', 'PARTNER6')
    const { orgId } = await openAccount('firm', { sp: 'PARTNER6' })
    const notices = await rows<J>(`select kind, dedupe_key, payload from dpdp.partner_notice where identity_id = $1`, [partner])
    expect(notices.length).toBe(1)
    expect(notices[0]).toMatchObject({ kind: 'referred_signup', dedupe_key: orgId, payload: { edition: 'firm' } })
    expect(JSON.stringify(notices[0].payload)).not.toMatch(/@|Org \d/)
  })
})

describe('the practitioner declaration is a record only: nobody is free, a firm opens on Professional and is billed like any other', () => {
  const declare = (v: boolean) => db.query(`select public.dpdp_account_save_profile($1::jsonb)`, [JSON.stringify({ practitionerDeclared: v })])

  test('the owner-verifies gate is gone: its three functions no longer exist', async () => {
    for (const f of ['dpdp_owner_verify_firm', 'dpdp_owner_pending_verifications', 'dpdp_account_set_professional']) {
      expect((await rows(`select 1 from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [f])).length, f).toBe(0)
    }
  })

  test('a firm that gives a professional body and number at opening is on the Professional plan at Rs 999, status "none" until it ticks the declaration', async () => {
    const { orgId, r } = await openAccount('firm', { body: 'ICAI', reg: '123456/W100' })
    expect(r.verification).toBe('none')
    expect(await account(orgId)).toMatchObject({ professional_body: 'ICAI', registration_no: '123456/W100', verification_status: 'none', plan_key: 'firm', locked_monthly_paise: 99900 })
    expect((await rows(`select 1 from dpdp.event where org_id = $1 and kind like 'firm_verification%'`, [orgId])).length).toBe(0)
  })

  test('the declaration changes NOTHING about the price: audited without the number or any e-mail, the firm stays on Professional, still in its trial, and it can be withdrawn', async () => {
    const { email, orgId } = await openAccount('firm', { body: 'ICMAI', reg: 'CMA-99887' })
    await as(email)
    await expect(db.query(`select public.dpdp_account_choose_plan('firm_free')`)).rejects.toThrow(/not available for this kind of account/) // the free plan is switched off
    const r = await one<J>(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb) as r`)
    expect(r).toMatchObject({ ok: true, status: 'declared', planKey: 'firm', note: null })
    expect(await account(orgId)).toMatchObject({ verification_status: 'declared', plan_key: 'firm', locked_monthly_paise: 99900 })
    const ev = await rows<J>(`select kind, summary, detail from dpdp.event where org_id = $1 and kind in ('firm_self_declared', 'plan_chosen')`, [orgId])
    expect(ev.map((e) => e.kind)).toEqual(['firm_self_declared']) // no "plan_chosen": nothing was chosen
    expect(JSON.stringify(ev)).not.toMatch(/CMA-99887|@/)
    expect(await stateOf(orgId)).toBe('TRIAL') // not ACTIVE: a declared practitioner is billed like everyone else
    await setClock(orgId, 400, null) // and when the trial is long over, working screens close
    expect(await stateOf(orgId)).toBe('LOCKED')
    await expect(db.query(`select public.t_work()`)).rejects.toThrow(/Payment is due/)
    await declare(false)
    expect(await account(orgId)).toMatchObject({ verification_status: 'none', plan_key: 'firm', locked_monthly_paise: 99900 })
  })

  test('the membership number is optional (declaring without one works) and its format is only checked, per body, for information', async () => {
    const a = await openAccount('firm')
    await as(a.email)
    await declare(true)
    expect(await account(a.orgId)).toMatchObject({ verification_status: 'declared', registration_no: null, registration_format_ok: null })
    const ok = async (body: string, no: string) => (await one<boolean | null>(`select dpdp.registration_format_ok($1, $2) as r`, [body, no])) as unknown as boolean | null
    expect(await ok('ICAI', '123456')).toBe(true)
    expect(await ok('ICAI', '001234S')).toBe(true)
    expect(await ok('ICAI', '12')).toBe(false)
    expect(await ok('ICSI', 'FCS 7788')).toBe(true)
    expect(await ok('ICSI', 'hello')).toBe(false)
    expect(await ok('ICMAI', 'F12345')).toBe(true)
    expect(await ok('other', 'anything at all')).toBeNull()
    expect(await ok('ICAI', ' ')).toBeNull()
    // a number that does not look right is KEPT and flagged, never refused
    await one(`select public.dpdp_account_save_profile('{"professionalBody": "ICAI", "registrationNo": "9999"}'::jsonb) as r`)
    expect((await account(a.orgId)).registration_no).toBe('9999')
    await one(`select public.dpdp_account_save_profile('{"professionalBody": "ICAI", "registrationNo": "123456"}'::jsonb) as r`)
    expect(await account(a.orgId)).toMatchObject({ professional_body: 'ICAI', registration_no: '123456', registration_format_ok: true })
  })

  test('a declaration needs a firm account; a firm with clients declares just the same and keeps its plan (no "own file, no clients" note any more)', async () => {
    const inst = await openAccount('institution')
    await as(inst.email)
    const r = await one<J>(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb) as r`)
    expect(r.ignored).toContain('practitionerDeclared')
    expect((await account(inst.orgId)).verification_status).toBe('none')
    const f = await openAccount('firm')
    await as(f.email)
    await db.query(`select public.dpdp_create_client_org('A client', 'dpdp')`)
    const r2 = await one<J>(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb, $1) as r`, [f.orgId])
    expect(r2).toMatchObject({ status: 'declared', planKey: 'firm', note: null })
  })

  test('only the platform owner sees the declared firms and may downgrade one; an ordinary owner and an anonymous caller are refused', async () => {
    const { email, orgId } = await openAccount('firm', { body: 'ICAI', reg: '445566' })
    await as(email)
    await declare(true)
    for (const who of [email, '']) {
      await as(who)
      await expect(db.query(`select public.dpdp_owner_declared_firms()`)).rejects.toThrow(/Owner only/)
      await expect(db.query(`select public.dpdp_owner_downgrade_firm($1)`, [orgId])).rejects.toThrow(/Owner only/)
    }
    await as('admin@veridian.test')
    const list = await one<J[]>(`select public.dpdp_owner_declared_firms() as r`)
    expect(list.find((x) => x.orgId === orgId)).toMatchObject({ status: 'declared', professionalBody: 'ICAI', registrationNo: '445566', formatOk: true, planKey: 'firm', isTest: false })
  })

  test('the owner\'s downgrade: audited, the firm stays on Professional at its signed-up price, and it cannot declare itself again', async () => {
    const { email, orgId } = await openAccount('firm', { body: 'ICAI', reg: '000111' })
    await as(email)
    await declare(true)
    await as('admin@veridian.test')
    const r = await one<J>(`select public.dpdp_owner_downgrade_firm($1, 'abuse review') as r`, [orgId])
    expect(r).toMatchObject({ ok: true, status: 'downgraded', planKey: 'firm' })
    expect(await account(orgId)).toMatchObject({ verification_status: 'downgraded', plan_key: 'firm', locked_monthly_paise: 99900 })
    const ev = await rows<J>(`select kind, detail from dpdp.event where org_id = $1 and kind = 'firm_downgraded'`, [orgId])
    expect(ev.length).toBe(1)
    expect(JSON.stringify(ev)).not.toMatch(/000111|@/)
    expect((await rows(`select 1 from dpdp.audit_platform_event where kind = 'firm_downgraded'`)).length).toBeGreaterThan(0)
    await as(email)
    const again = await one<J>(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb) as r`)
    expect(again.ignored).toContain('practitionerDeclared')
    expect(again.note).toMatch(/paid plan/)
    expect((await account(orgId)).verification_status).toBe('downgraded')
    const inst = await openAccount('institution')
    await as('admin@veridian.test')
    await expect(db.query(`select public.dpdp_owner_downgrade_firm($1)`, [inst.orgId])).rejects.toThrow(/No such firm account/)
  })

  test('nobody is free: even an old row forced onto the retired free plan with a declaration on it is billed (dpdp.account_is_free is always false)', async () => {
    const { orgId } = await openAccount('firm')
    await db.query(`update dpdp.account set plan_key = 'firm_free', locked_monthly_paise = 0, verification_status = 'declared' where org_id = $1`, [orgId])
    await setClock(orgId, 100, null)
    expect(await stateOf(orgId)).toBe('LOCKED')
    expect((await one<J>(`select dpdp.account_is_free(a) as r from dpdp.account a where a.org_id = $1`, [orgId])) as unknown as boolean).toBe(false)
  })
})

describe('the client cap: ten until the first monthly or yearly payment, then none (the price follows the number of clients)', () => {
  const addClient = (name = 'Client') => db.query(`select public.dpdp_create_client_org($1, 'institution')`, [name])
  const used = async (firm: string) => (await rows<J>(`select count(*)::int as c from dpdp.account_client where firm_org_id = $1`, [firm]))[0].c as number

  test('on the free 30 days the 11th client is refused in calm words about the trial pack, and nothing is created for it', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    for (let i = 1; i <= 10; i++) await addClient(`C${i}`)
    expect(await used(orgId)).toBe(10)
    const before = (await rows<J>(`select count(*)::int as c from public.t_core_client_calls`))[0].c
    await expect(addClient('C11')).rejects.toThrow(/Your trial pack covers up to 10 client organisations\. To add more, start the monthly or yearly plan: it covers any number of clients \(Rs 20 a month for each client beyond 10\)\./)
    expect((await rows<J>(`select count(*)::int as c from public.t_core_client_calls`))[0].c).toBe(before) // the real creator was never reached
    expect(await used(orgId)).toBe(10)
  })

  test('the trial PACK does not lift the cap; the first MONTHLY payment does, and from then on the price follows the count', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    for (let i = 1; i <= 10; i++) await addClient(`D${i}`)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'pack')`, [orgId])
    await as(email)
    await expect(addClient('D11')).rejects.toThrow(/Your trial pack covers up to 10 client organisations/)
    let mine = await one<J>(`select public.dpdp_my_account($1) as r`, [orgId])
    expect(mine.clients).toEqual({ used: 10, cap: 10, included: 10, unlimited: false })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    await as(email)
    await addClient('D11')
    await addClient('D12')
    expect(await used(orgId)).toBe(12)
    mine = await one<J>(`select public.dpdp_my_account($1) as r`, [orgId])
    expect(mine.clients).toEqual({ used: 12, cap: null, included: 10, unlimited: true })
    expect(mine.money).toMatchObject({ monthPaise: 99900 + 2 * 2000, yearPaise: (99900 + 2 * 2000) * 6, baseMonthlyPaise: 99900, perClient: { includedClients: 10, extraMonthlyPaise: 2000, clientsCounted: 12, extraClients: 2 } })
  })

  test('the only plan a firm can choose is Professional; the retired tiers, the free plan and an institution plan are refused', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    for (const key of ['firm_free', 'firm_starter', 'firm_growth', 'firm_practice', 'firm_large', 'institution', 'nope']) {
      await expect(db.query(`select public.dpdp_account_choose_plan($1, 'month', $2)`, [key, orgId]), key).rejects.toThrow(/not available/)
    }
    const ok = await one<J>(`select public.dpdp_account_choose_plan('firm', 'year', $1) as r`, [orgId])
    expect(ok).toMatchObject({ ok: true, planKey: 'firm', monthlyPaise: 99900 })
    expect((await account(orgId)).billing_interval).toBe('year')
  })

  test('a client is an organisation, not a user: adding more people to a client does not count', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    const c = await one<J>(`select public.dpdp_create_client_org('One client', 'institution') as r`)
    for (let i = 0; i < 5; i++) {
      await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2)`, [`i_x${orgId}${i}`, `x${orgId}${i}@c.test`])
      await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ($1, $2, $3, 'staff', 'invited')`, [`m_x${orgId}${i}`, `i_x${orgId}${i}`, c.orgId])
    }
    expect(await used(orgId)).toBe(1)
  })

  test('the firm and the client are linked, audited without a name, and two firms are told apart', async () => {
    const f = await openAccount('firm')
    const g = await openAccount('firm')
    await as(f.email)
    await addClient('Linked client')
    expect(await used(f.orgId)).toBe(1)
    expect(await used(g.orgId)).toBe(0)
    const ev = await rows<J>(`select summary, actor_label from dpdp.event where org_id = $1 and kind = 'client_added'`, [f.orgId])
    expect(ev.length).toBe(1)
    expect(JSON.stringify(ev)).not.toContain('Linked client')
  })

  test('a person in two firms must say which; a firm they are not in is refused', async () => {
    const f = await openAccount('firm')
    const g = await openAccount('firm')
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) select 'm_both' || $1, m.identity_id, $2, 'staff', 'invited' from dpdp.membership m where m.org_id = $3`, [f.orgId, g.orgId, f.orgId])
    await as(f.email)
    await expect(addClient()).rejects.toThrow(/Choose which firm/)
    await db.query(`select public.dpdp_create_client_org('Pick', 'institution', null, $1)`, [g.orgId])
    const h = await openAccount('firm')
    await as(f.email)
    await expect(db.query(`select public.dpdp_create_client_org('Nope', 'institution', null, $1)`, [h.orgId])).rejects.toThrow(/Not a member of that firm/)
  })

  test('an older firm with no account row has no cap and no link (nothing about it changed)', async () => {
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_old', 'old@legacy.test')`)
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_old', 'i_old', 'old@legacy.test', true)`)
    await db.query(`insert into dpdp.organisation (id, name, slug, product) values ('o_old', 'Old firm', 'o_old', 'firm')`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_old', 'i_old', 'o_old', 'owner', 'created')`)
    await as('old@legacy.test')
    for (let i = 0; i < 13; i++) await addClient(`L${i}`)
    expect((await rows<J>(`select count(*)::int as c from dpdp.account_client`))[0].c).toBeGreaterThan(0)
    expect(await stateOf('o_old')).toBe('ACTIVE')
  })

  test('a locked firm cannot add clients either', async () => {
    const { email, orgId } = await openAccount('firm')
    await setClock(orgId, 100, null)
    await as(email)
    await expect(addClient()).rejects.toThrow(/Payment is due for this account/)
  })
})

describe('the lock: what refuses, what stays open, and what unlocks', () => {
  test('TRIAL, DUE and GRACE: everything works (and the owner can see the state, DUE and GRACE with the calm line)', async () => {
    const { email, orgId } = await openAccount('institution')
    await as(email)
    for (const [opened, state] of [[5, 'TRIAL'], [30.5, 'DUE'], [32, 'GRACE'], [37.5, 'GRACE']] as const) {
      await setClock(orgId, opened, null)
      expect(await stateOf(orgId), `${opened} days`).toBe(state)
      await db.query(`select public.t_work()`)
      const mine = await one<J>(`select public.dpdp_my_account() as r`)
      expect(mine.state).toBe(state)
      expect(mine.dueLine).toBe(dueLine(state))
    }
  })

  test('LOCKED: a working screen refuses with the plain sentence; a stranger still gets the ordinary refusal', async () => {
    const { email, orgId } = await openAccount('institution')
    await setClock(orgId, 38.5, null)
    expect(await stateOf(orgId)).toBe('LOCKED')
    await as(email)
    await expect(db.query(`select public.t_work()`)).rejects.toThrow(/^Payment is due for this account, so this screen is paused\./)
    await expect(db.query(`select public.t_work($1)`, [orgId])).rejects.toThrow(/Payment is due/)
    await as('stranger@nowhere.test')
    await expect(db.query(`select public.t_work()`)).rejects.toThrow(/Not a member of this organisation/)
  })

  test('LOCKED: the always-open actions work (pay screen, my account, declare payment, pay begin, download, record a breach, answer a grievance)', async () => {
    const { email, orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    await db.query(`insert into dpdp.obligation_template (id, name) values ('t1', 'Name a Grievance Officer') on conflict do nothing`)
    await db.query(`insert into dpdp.obligation (id, org_id, template_id, due_on) values ('ob1', $1, 't1', date '2027-05-13')`, [orgId])
    await db.query(`insert into dpdp.grievance (id, org_id, ref, summary) values ('g1', $1, 'GR-2026-0001', 'A person complained')`, [orgId])
    await as(email)
    expect((await one<J>(`select public.dpdp_my_billing() as r`)).orgId).toBe(orgId)
    expect((await one<J>(`select public.dpdp_declare_payment('month', 39900, null, 'UTR1', null, null) as r`)).ok).toBe(true)
    expect((await one<J>(`select public.dpdp_pay_begin('year', null, ${TICK}) as r`)).orgId).toBe(orgId)
    const mine = await one<J>(`select public.dpdp_my_account() as r`)
    expect(mine).toMatchObject({ state: 'LOCKED', money: { monthPaise: 99900 } })
    const dl = await one<J>(`select public.dpdp_locked_download() as r`)
    expect(dl.organisation.id).toBe(orgId)
    expect(dl.jobs.map((j: J) => j.job)).toEqual(['Name a Grievance Officer'])
    expect(dl.history.length).toBeGreaterThan(0)
    const breach = await one<J>(`select public.dpdp_locked_record_breach('A laptop with customer data was lost') as r`)
    expect(breach.ok).toBe(true)
    const row = (await rows<J>(`select * from dpdp.breach where id = $1`, [breach.breachId]))[0]
    expect(new Date(row.deadline_at).getTime() - new Date(row.became_aware_at).getTime()).toBe(72 * 3600_000) // the 72-hour clock starts now
    await db.query(`select public.dpdp_locked_answer_grievance('GR-2026-0001', 'We have corrected the record.')`)
    expect((await rows<J>(`select state, officer_decision from dpdp.grievance where id = 'g1'`))[0]).toEqual({ state: 'answered', officer_decision: 'We have corrected the record.' })
    // ...and they are still gated by who the caller is
    await expect(db.query(`select public.dpdp_locked_answer_grievance('GR-2026-0001', 'again')`)).rejects.toThrow(/No open grievance/)
    await expect(db.query(`select public.dpdp_locked_record_breach('   ')`)).rejects.toThrow(/Describe what happened/)
  })

  test('the allow flag lasts one transaction: a working screen called right after an allowed one is still refused', async () => {
    const { email, orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    await as(email)
    await db.query(`select public.dpdp_my_billing()`)
    await expect(db.query(`select public.t_work()`)).rejects.toThrow(/Payment is due/)
    expect((await rows<J>(`select current_setting('dpdp.allow_locked', true) as v`))[0].v).not.toBe('on')
  })

  test('the always-open actions still check WHO: a stranger, and a non-owner on the owner-only ones', async () => {
    const { orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    await db.query(`insert into dpdp.identity (id, primary_email) values ('i_st', 'staff@x.test') on conflict do nothing`)
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_st', 'i_st', 'staff@x.test', true) on conflict do nothing`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_st', 'i_st', $1, 'staff', 'invited')`, [orgId])
    await as('staff@x.test')
    await expect(db.query(`select public.dpdp_locked_download($1)`, [orgId])).rejects.toThrow(/Only the owner/)
    await expect(db.query(`select public.dpdp_locked_answer_grievance('x', 'y', $1)`, [orgId])).rejects.toThrow(/Only the owner/)
    expect((await one<J>(`select public.dpdp_locked_record_breach('Seen by staff', $1) as r`, [orgId])).ok).toBe(true) // anyone who notices a breach may record it
    await as('stranger@nowhere.test')
    await expect(db.query(`select public.dpdp_locked_record_breach('x', $1)`, [orgId])).rejects.toThrow(/Not a member/)
    await as('')
    await expect(db.query(`select public.dpdp_my_account()`)).rejects.toThrow(/Not a member/)
  })

  test('the AI work link: refused when LOCKED with the plain sentence, working in DUE / GRACE, and expired/revoked is still the old message', async () => {
    const { orgId } = await openAccount('institution')
    const m = `m_${orgId}`
    const exp = iso(new Date(Date.now() + DAY))
    // sha256('tok-1') etc: the function hashes whatever token it is given
    for (const t of ['tok-1', 'tok-2']) {
      const h = (await rows<J>(`select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [t]))[0].h
      await db.query(`insert into dpdp.ai_link (id, token_hash, membership_id, org_id, expires_at, revoked_at) values ($1, $2, $3, $4, $5, $6)`, [`l-${t}`, h, m, orgId, exp, t === 'tok-2' ? iso(new Date()) : null])
    }
    await setClock(orgId, 32, null)
    expect(((await rows<J>(`select (public.dpdp__ai_link_for_token('tok-1')).id as id`))[0]).id).toBe('l-tok-1') // GRACE: works
    await setClock(orgId, 60, null)
    await expect(db.query(`select public.dpdp__ai_link_for_token('tok-1')`)).rejects.toThrow(/^Payment is due for this account/)
    await expect(db.query(`select public.dpdp__ai_link_for_token('tok-2')`)).rejects.toThrow(/This link has expired or was revoked/)
    await expect(db.query(`select public.dpdp__ai_link_for_token('nothing')`)).rejects.toThrow(/This link has expired or was revoked/)
  })

  test('a managed client organisation follows its firm: the firm locks, the client locks with it; paying unlocks both', async () => {
    const f = await openAccount('firm')
    await as(f.email)
    const c = await one<J>(`select public.dpdp_create_client_org('Follower', 'institution') as r`)
    expect(await stateOf(c.orgId)).toBe('TRIAL')
    await setClock(f.orgId, 100, null)
    expect(await stateOf(c.orgId)).toBe('LOCKED')
    await expect(db.query(`select public.t_work($1)`, [c.orgId])).rejects.toThrow(/Payment is due/)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [f.orgId])
    expect(await stateOf(c.orgId)).toBe('ACTIVE')
    await as(f.email)
    await db.query(`select public.t_work($1)`, [c.orgId])
  })

  test('an organisation older than this migration (no account row) is never locked', async () => {
    expect(await stateOf('o_old')).toBe('ACTIVE')
    await as('old@legacy.test')
    await db.query(`select public.t_work('o_old')`)
  })
})

describe('mark paid (owner only) and what a payment does', () => {
  test('only the platform owner can mark paid; an owner of the account and an anonymous caller are refused and nothing changes', async () => {
    const { email, orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    for (const who of [email, '']) {
      await as(who)
      await expect(db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])).rejects.toThrow(/Owner only/)
    }
    expect((await account(orgId)).paid_until).toBeNull()
    expect(await stateOf(orgId)).toBe('LOCKED')
  })

  test('marking paid unlocks, books exactly one payment at the price the account signed up at, and is audited without a figure or an address', async () => {    const { email, orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    await as('admin@veridian.test')
    const r = await one<J>(`select public.dpdp_owner_mark_paid($1, 'month', null, null, 'UTR 998877', 'bank transfer') as r`, [orgId])
    expect(r.ok).toBe(true)
    const pay = await rows<J>(`select plan, "interval", amount_paise, confirmed_note from dpdp.payment where org_id = $1`, [orgId])
    expect(pay).toEqual([{ plan: 'institution', interval: 'month', amount_paise: 99900, confirmed_note: 'Ref UTR 998877. bank transfer' }])
    expect(await stateOf(orgId)).toBe('ACTIVE')
    await as(email)
    await db.query(`select public.t_work()`)
    const ev = await rows<J>(`select kind, summary, detail, actor_label from dpdp.event where org_id = $1 and kind = 'account_marked_paid'`, [orgId])
    expect(ev.length).toBe(1)
    expect(JSON.stringify(ev)).not.toMatch(/@|99900|UTR/)
  })

  test('paid-until: a month from now when it had lapsed; from the END of the trial when paid during the trial; a year is twelve months for six months\' price (half)', async () => {
    const a = await openAccount('institution')
    await setClock(a.orgId, 100, null)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [a.orgId])
    const lapsed = await account(a.orgId)
    const days = (x: Date) => (x.getTime() - Date.now()) / DAY
    expect(days(new Date(lapsed.paid_until + 'Z'))).toBeGreaterThan(28)
    expect(days(new Date(lapsed.paid_until + 'Z'))).toBeLessThan(32)

    const b = await openAccount('institution') // day 0: paying early does not waste the trial days
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [b.orgId])
    expect(days(new Date((await account(b.orgId)).paid_until + 'Z'))).toBeGreaterThan(58)
    expect(days(new Date((await account(b.orgId)).paid_until + 'Z'))).toBeLessThan(62)

    const c = await openAccount('institution')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'year')`, [c.orgId])
    expect((await rows<J>(`select amount_paise from dpdp.payment where org_id = $1`, [c.orgId]))[0].amount_paise).toBe(599400)
    expect(days(new Date((await account(c.orgId)).paid_until + 'Z'))).toBeGreaterThan(30 + 364)
  })

  test('an explicit paid-until date overrides the working-out', async () => {
    const { orgId } = await openAccount('institution')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month', null, date '2031-06-30')`, [orgId])
    expect((await rows<J>(`select to_char(paid_until, 'YYYY-MM-DD') as d from dpdp.account where org_id = $1`, [orgId]))[0].d).toBe('2031-06-30')
  })

  test('refusals: a bad interval, an unknown account, and a second trial pack (the pack is once only)', async () => {
    const { orgId } = await openAccount('institution')
    await as('admin@veridian.test')
    await expect(db.query(`select public.dpdp_owner_mark_paid($1, 'week')`, [orgId])).rejects.toThrow(/interval must be/)
    await expect(db.query(`select public.dpdp_owner_mark_paid('nope', 'month')`)).rejects.toThrow(/No such account/)
    await db.query(`select public.dpdp_owner_mark_paid($1, 'pack')`, [orgId])
    await expect(db.query(`select public.dpdp_owner_mark_paid($1, 'pack')`, [orgId])).rejects.toThrow(/only for an account that has not paid yet/)
  })

  test('a payment that arrives while LOCKED re-prices the account to today\'s plan price; one that arrives while active keeps the price it signed up at (offer fixture)', async () => {
    try {
      await festiveOffer()
      const a = await openAccount('institution')
      await endOffer()
      await as('admin@veridian.test')
      await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [a.orgId]) // still in its trial: keeps 399
      expect((await account(a.orgId)).locked_monthly_paise).toBe(39900)
      const b = await openAccount('institution') // signs up at the LIST price now
      expect((await account(b.orgId)).locked_monthly_paise).toBe(80100)
      await setClock(a.orgId, 400, null)
      await db.query(`update dpdp.account set paid_until = null where org_id = $1`, [a.orgId])
      await as('admin@veridian.test')
      await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [a.orgId]) // came back from LOCKED: today's price
      expect((await account(a.orgId)).locked_monthly_paise).toBe(80100)
    } finally {
      await restoreOffer()
    }
  })

  test('a claim approved through the existing owner flow (dpdp_record_confirmed_payment, which a Razorpay webhook also reaches) moves paid-until the same way', async () => {
    const { orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    await db.query(`select public.dpdp_record_confirmed_payment($1, 'institution', 'month', 39900, current_date, null)`, [orgId])
    expect(await stateOf(orgId)).toBe('ACTIVE')
    expect((await account(orgId)).first_paid_at).not.toBeNull()
  })

  test('a locked owner can still say "I have paid" (a claim), but the account stays locked until the Owner marks it paid', async () => {
    const { email, orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    await as(email)
    await db.query(`select public.dpdp_declare_payment('month', 39900)`)
    expect(await stateOf(orgId)).toBe('LOCKED')
  })
})

describe('the partner commission: 50% of what was actually paid, first 12 months, partner-attributed accounts only', () => {
  const commissions = async (orgId: string) => rows<J>(`select base_paise, amount_paise, rate_percent from dpdp.account_commission where org_id = $1 order by created_at`, [orgId])

  test('a first payment earns 50% of the price actually paid', async () => {
    const partner = await addPartner('c1', 'COMM0001')
    const { orgId } = await openAccount('institution', { sp: 'COMM0001' })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    expect(await commissions(orgId)).toEqual([{ base_paise: 99900, amount_paise: 49950, rate_percent: '50.00' }])
    const notices = await rows<J>(`select kind, payload from dpdp.partner_notice where identity_id = $1 and kind = 'commission_earned'`, [partner])
    expect(notices.length).toBe(1)
    expect(notices[0].payload).toEqual({ amountPaise: 49950, basis: 'monthly_first_year' })
  })

  test('a yearly payment earns 50% of the half-price year (six months of the monthly price)', async () => {
    await addPartner('c2', 'COMM0002')
    const { orgId } = await openAccount('institution', { sp: 'COMM0002' })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'year')`, [orgId])
    expect(await commissions(orgId)).toEqual([{ base_paise: 599400, amount_paise: 299700, rate_percent: '50.00' }])
  })

  test('the Rs 99 trial pack earns the partner NOTHING; the first monthly payment after it does, and starts the 12 months', async () => {
    const partner = await addPartner('c5', 'COMM0005')
    const { orgId } = await openAccount('institution', { sp: 'COMM0005' })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'pack')`, [orgId])
    expect(await commissions(orgId)).toEqual([])
    expect((await rows<J>(`select 1 from dpdp.partner_notice where identity_id = $1 and kind = 'commission_earned'`, [partner])).length).toBe(0)
    expect(await account(orgId)).toMatchObject({ first_paid_at: null })
    expect((await account(orgId)).pack_paid_at).not.toBeNull()
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    expect(await commissions(orgId)).toEqual([{ base_paise: 99900, amount_paise: 49950, rate_percent: '50.00' }])
    expect((await account(orgId)).first_paid_at).not.toBeNull()
  })

  test('payments inside the 12 months keep earning; the first one after 12 months earns nothing; an account with no partner never creates one', async () => {
    await addPartner('c3', 'COMM0003')
    const { orgId } = await openAccount('institution', { sp: 'COMM0003' })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    expect((await commissions(orgId)).length).toBe(2)
    await db.query(`update dpdp.account set first_paid_at = now() at time zone 'utc' - interval '12 months 1 day' where org_id = $1`, [orgId])
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    expect((await commissions(orgId)).length).toBe(2)
    const none = await openAccount('institution')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [none.orgId])
    expect((await commissions(none.orgId)).length).toBe(0)
  })

  test('commission follows the price that was charged: an owner-approved partner code that went below the plan price earns on the lower price', async () => {
    const partner = await addPartner('c4', 'COMM0004')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_set_partner_code($1, 'LOW0004', 20, true)`, [partner])
    const { orgId } = await openAccount('institution', { sp: 'LOW0004' })
    expect((await account(orgId)).locked_monthly_paise).toBe(79920)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    expect((await commissions(orgId))[0]).toMatchObject({ base_paise: 79920, amount_paise: 39960 })
  })

  test('a firm\'s commission is on the whole payment, per-client part included', async () => {
    await addPartner('c6', 'COMM0006')
    const f = await openAccount('firm', { sp: 'COMM0006' })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [f.orgId]) // no clients yet: Rs 999; this payment also lifts the ten-client cap
    await as(f.email)
    for (let i = 1; i <= 12; i++) await db.query(`select public.dpdp_create_client_org($1, 'institution')`, [`CM${i}`])
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [f.orgId])
    expect(await commissions(f.orgId)).toEqual([
      { base_paise: 99900, amount_paise: 49950, rate_percent: '50.00' },
      { base_paise: 103900, amount_paise: 51950, rate_percent: '50.00' }, // 999 + 2 x 20 = 1,039
    ])
  })
})

describe('e-mails to the account\'s own contacts: they continue, each with a one-click unsubscribe, and it is logged', () => {
  const worklist = (dry = false, now = 'now()') => one<J[]>(`select public.dpdp_billing_due_worklist(${now}, 500, $1) as r`, [dry])

  async function dueAccount(daysOpen: number, billing?: string) {
    const o = await openAccount('institution', { billing })
    await setClock(o.orgId, daysOpen, null)
    // a head of department
    await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2)`, [`i_hod${o.orgId}`, `hod${o.orgId}@acct.test`])
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true)`, [`ie_hod${o.orgId}`, `i_hod${o.orgId}`, `hod${o.orgId}@acct.test`])
    await db.query(`insert into dpdp.audit_org_policy (org_id, hod_identity_ids) values ($1, array[$2])`, [o.orgId, `i_hod${o.orgId}`])
    return o
  }
  const mine = (all: J[], orgId: string) => all.filter((x) => x.orgId === orgId)

  test('an account that is TRIAL or ACTIVE is not listed; DUE, GRACE and LOCKED are, with owner, head of department and billing contact', async () => {
    const trial = await dueAccount(5)
    const due = await dueAccount(30.5, 'Accounts@Acme.Test')
    const locked = await dueAccount(90)
    const paid = await dueAccount(90)
    await db.query(`update dpdp.account set paid_until = now() at time zone 'utc' + interval '10 days' where org_id = $1`, [paid.orgId])
    const all = await worklist()
    expect(mine(all, trial.orgId)).toEqual([])
    expect(mine(all, paid.orgId)).toEqual([])
    expect(mine(all, due.orgId).map((x) => [x.role, x.state]).sort()).toEqual([['billing contact', 'DUE'], ['head of department', 'DUE'], ['owner', 'DUE']])
    expect(mine(all, due.orgId).find((x) => x.role === 'billing contact')!.email).toBe('accounts@acme.test')
    expect(mine(all, locked.orgId).every((x) => x.state === 'LOCKED' && x.line === dueLine('LOCKED'))).toBe(true)
    expect(mine(all, locked.orgId).every((x) => /^bn_[a-f0-9]{64}$/.test(x.unsubscribeToken))).toBe(true)
  })

  test('once per contact per week: the same contacts are not listed again until their send fails', async () => {
    const o = await dueAccount(40)
    const first = mine(await worklist(), o.orgId)
    expect(first.length).toBe(2)
    expect(mine(await worklist(), o.orgId)).toEqual([])
    await db.query(`select public.dpdp_billing_notice_mark($1, $2, $3, 'sent')`, [o.orgId, first[0].email, first[0].weekKey])
    await db.query(`select public.dpdp_billing_notice_mark($1, $2, $3, 'failed')`, [o.orgId, first[1].email, first[1].weekKey])
    const again = mine(await worklist(), o.orgId)
    expect(again.map((x) => x.email)).toEqual([first[1].email])
  })

  test('a dry run lists who would be mailed and writes nothing (no claim, no token)', async () => {
    const o = await dueAccount(40)
    const t0 = (await rows<J>(`select count(*)::int as c from dpdp.billing_notice_token`))[0].c
    expect(mine(await worklist(true), o.orgId).length).toBe(2)
    expect((await rows<J>(`select count(*)::int as c from dpdp.billing_notice_token`))[0].c).toBe(t0)
    expect(mine(await worklist(false), o.orgId).length).toBe(2) // so the real run still finds them
  })

  test('the one-click unsubscribe (through the existing dpdp_unsubscribe): that contact stops, the others do not, the audit trail has a line with NO address', async () => {
    const o = await dueAccount(40)
    const first = mine(await worklist(), o.orgId)
    const hod = first.find((x) => x.role === 'head of department')!
    const r = await one<J>(`select public.dpdp_unsubscribe($1) as r`, [hod.unsubscribeToken])
    expect(r).toEqual({ ok: true, email: hod.email })
    const ev = await rows<J>(`select kind, summary, detail, actor_label from dpdp.event where org_id = $1 and kind = 'billing_email_unsubscribed'`, [o.orgId])
    expect(ev.length).toBe(1)
    expect(JSON.stringify(ev)).not.toContain('@')
    // pressing it twice is harmless and writes nothing more
    await db.query(`select public.dpdp_unsubscribe($1)`, [hod.unsubscribeToken])
    expect((await rows<J>(`select 1 from dpdp.event where org_id = $1 and kind = 'billing_email_unsubscribed'`, [o.orgId])).length).toBe(1)
    // next week the owner is still listed, the head of department is not
    for (const x of first) await db.query(`select public.dpdp_billing_notice_mark($1, $2, $3, 'failed')`, [o.orgId, x.email, x.weekKey])
    const next = mine(await worklist(), o.orgId)
    expect(next.map((x) => x.role)).toEqual(['owner'])
  })

  test('an unknown or malformed unsubscribe token is refused; an old-style token still goes the old way', async () => {
    expect(await one<J>(`select public.dpdp_unsubscribe('bn_nonsense') as r`)).toEqual({ ok: false, reason: 'This link is not valid.' })
    expect(await one<J>(`select public.dpdp_unsubscribe(null) as r`)).toEqual({ ok: false, reason: 'old path' })
    expect(await one<J>(`select public.dpdp_unsubscribe('plain-old-token') as r`)).toEqual({ ok: false, reason: 'old path' })
    expect(await one<J>(`select public.dpdp_unsubscribe('bn_' || repeat('a', 5000)) as r`)).toEqual({ ok: false, reason: 'This link is not valid.' })
  })

  test('an owner who already stopped the weekly e-mail is not sent billing notes either', async () => {
    const o = await dueAccount(40)
    await db.query(`insert into dpdp.email_preference (membership_id, unsubscribed_at, statutory_only) values ($1, now(), true)`, [`m_${o.orgId}`])
    expect(mine(await worklist(), o.orgId).map((x) => x.role)).toEqual(['head of department'])
  })

  test('the e-mails carry on for ever: a year after the period ended the account is still listed (one note a week, never stopped by the clock)', async () => {
    const o = await dueAccount(30 + 400)
    expect(mine(await worklist(), o.orgId).length).toBe(2)
    const inAYear = mine(await worklist(false, `now() + interval '40 weeks'`), o.orgId)
    expect(inAYear.length).toBe(2)
  })

  test('the final download notice is flagged once, 90 days after the period end, and not before; marking it records it', async () => {
    const early = await dueAccount(30 + 89)
    const late = await dueAccount(30 + 91)
    const all = await worklist()
    expect(mine(all, early.orgId).every((x) => x.finalDownload === false)).toBe(true)
    expect(mine(all, late.orgId).every((x) => x.finalDownload === true)).toBe(true)
    await db.query(`select public.dpdp_billing_final_download_mark($1)`, [late.orgId])
    await db.query(`delete from dpdp.billing_notice_sent`)
    expect(mine(await worklist(), late.orgId).every((x) => x.finalDownload === false)).toBe(true)
    expect((await rows<J>(`select 1 from dpdp.event where org_id = $1 and kind = 'final_download_notice_sent'`, [late.orgId])).length).toBe(1)
    expect((await one<J>(`select public.dpdp_billing_final_download_mark($1) as r`, [late.orgId])).marked).toBe(false)
  })

  test('the line the e-mails (Monday digest) carry: present for DUE / GRACE / LOCKED, absent for TRIAL / ACTIVE', async () => {
    const o = await openAccount('institution')
    for (const [days, state] of [[5, null], [30.5, 'DUE'], [32, 'GRACE'], [60, 'LOCKED']] as const) {
      await setClock(o.orgId, days, null)
      const d = await one<J | null>(`select public.dpdp_timer_billing_due_line($1) as r`, [o.orgId])
      if (state === null) expect(d).toBeNull()
      else expect(d).toEqual({ state, line: dueLine(state) })
    }
    expect(await one<J | null>(`select public.dpdp_timer_billing_due_line('o_old') as r`)).toBeNull()
  })
})

describe('the roll-back file (drizzle/down/0734)', () => {
  test('applied after the migration it removes every new table and function, and the original names and gate-free doors are back', async () => {
    const fresh = new PGlite()
    await fresh.exec(BASE_SQL)
    await fresh.exec(read(F0734))
    await fresh.exec(read('drizzle/down/0734_dpdp_account_opening_plans_billing.down.sql'))
    const q = async <T = J>(sql: string) => (await fresh.query<T>(sql)).rows
    expect((await q(`select count(*)::int as c from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname in ('plan','account','account_client','account_commission','billing_setting','partner_offer_code','billing_email_optout','billing_notice_token','billing_notice_sent')`))[0].c).toBe(0)
    expect((await q(`select proname from pg_proc where proname in ('dpdp_open_account','dpdp_my_account','dpdp_owner_mark_paid','dpdp__my_billing_core','dpdp__create_client_org_core','dpdp__caller_membership_open','assert_not_locked','account_on_payment')`)).length).toBe(0)
    for (const f of ['dpdp_my_billing', 'dpdp_declare_payment', 'dpdp_pay_begin', 'dpdp_create_client_org']) expect((await q<{ n: number }>(`select count(*)::int as n from pg_proc where proname = '${f}'`))[0].n).toBe(1)
    // the original doors carry no payment gate any more
    expect((await q<{ s: string }>(`select prosrc as s from pg_proc where proname = 'dpdp__caller_membership'`))[0].s).not.toContain('assert_not_locked')
    expect((await q<{ s: string }>(`select prosrc as s from pg_proc where proname = 'dpdp__ai_link_for_token'`))[0].s).not.toContain('assert_not_locked')
    await fresh.close()
  }, 120_000)
})

describe('the roll-back file (drizzle/down/0755)', () => {
  const DOWN = 'drizzle/down/0755_dpdp_pricing_trial_pack_and_per_client.down.sql'

  test('it refuses while a trial-pack payment exists; with none, it puts the plans, the institution price and the ten-month year back and removes the new columns and helpers', async () => {
    const fresh = new PGlite()
    await fresh.exec(BASE_SQL)
    for (const f of [F0733, F0734, F0735, F0748]) await fresh.exec(read(f))
    await fresh.exec(PAYMENT_ATTEMPT_SQL)
    await fresh.exec(read(F0755))
    const q = async <T = J>(sql: string) => (await fresh.query<T>(sql)).rows
    await fresh.exec(`insert into dpdp.organisation (id, name, slug, product) values ('o_pk', 'Pack org', 'o_pk', 'institution')`)
    await fresh.exec(`insert into dpdp.payment (id, org_id, plan, "interval", amount_paise) values ('p_pk', 'o_pk', 'institution', 'pack', 9900)`)
    await expect(fresh.exec(read(DOWN))).rejects.toThrow() // the constraint re-add fails on purpose: refund or re-label the pack first
    await fresh.exec('rollback')
    await fresh.exec(`delete from dpdp.payment where id = 'p_pk'`)
    await fresh.exec(read(DOWN))
    expect((await q<{ key: string }>(`select key from dpdp.plan where active order by sort_order`)).map((p) => p.key)).toEqual(['institution', 'firm_free', 'firm_starter', 'firm_growth', 'firm_practice', 'firm_large'])
    expect((await q<J>(`select name, list_monthly_paise, offer_monthly_paise from dpdp.plan where key = 'institution'`))[0]).toEqual({ name: 'Institution', list_monthly_paise: 80100, offer_monthly_paise: 39900 })
    expect((await q<J>(`select yearly_months_charged as y from dpdp.billing_setting`))[0].y).toBe(10)
    expect((await q<J>(`select count(*)::int as c from information_schema.columns where table_schema = 'dpdp' and ((table_name = 'billing_setting' and column_name like 'pack_%') or (table_name = 'account' and column_name = 'pack_paid_at') or (table_name = 'plan' and column_name in ('included_clients', 'extra_client_monthly_paise')))`))[0].c).toBe(0)
    expect((await q<J>(`select count(*)::int as c from pg_proc where proname in ('ensure_account', 'account_charge_paise', 'account_monthly_total_paise', 'account_pack_available', 'account_client_cap')`))[0].c).toBe(0)
    await expect(fresh.exec(`insert into dpdp.payment (id, org_id, plan, "interval", amount_paise) values ('p_pk2', 'o_pk', 'institution', 'pack', 9900)`)).rejects.toThrow()
    await fresh.close()
  }, 180_000)
})

describe('who can reach what (grants), and the audit trail never carries a person', () => {
  test('the browser roles cannot read or write any of the new tables, and cannot call the internal functions or the cores', async () => {
    const tables = ['billing_setting', 'plan', 'partner_offer_code', 'account', 'account_client', 'account_commission', 'billing_email_optout', 'billing_notice_token', 'billing_notice_sent']
    for (const t of tables) {
      const rls = (await rows<J>(`select relrowsecurity as r from pg_class where oid = 'dpdp.${t}'::regclass`))[0].r
      expect(rls, t).toBe(true)
      for (const role of ['anon', 'authenticated']) {
        const priv = (await rows<J>(`select has_table_privilege($1, 'dpdp.${t}', 'select, insert, update, delete') as ok`, [role]))[0].ok
        expect(priv, `${role} on ${t}`).toBe(false)
      }
    }
    const internal = ['dpdp.billing_state_calc(boolean, timestamp, timestamp, timestamp, integer, integer, integer)', 'dpdp.assert_not_locked(text)', 'dpdp.account_on_payment()', 'public.dpdp__my_billing_core(text)',
      'public.dpdp__create_client_org_core(text, text, text)', 'public.dpdp__caller_membership_open(text)', 'public.dpdp_billing_due_worklist(timestamptz, integer, boolean)', 'public.dpdp_timer_billing_due_line(text)']
    for (const f of internal) for (const role of ['anon', 'authenticated']) expect((await rows<J>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, f]))[0].ok, `${role} on ${f}`).toBe(false)
    for (const f of ['public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text, text, boolean)', 'public.dpdp_my_account(text)', 'public.dpdp_locked_download(text)', 'public.dpdp_my_billing(text)', 'public.dpdp_create_client_org(text, text, text, text)',
      'public.dpdp_create_my_org(text, text, text, text, boolean)', 'public.dpdp_pay_begin(text, text, text, boolean)'])
      expect((await rows<J>(`select has_function_privilege('authenticated', $1, 'execute') as ok`, [f]))[0].ok, f).toBe(true)
    expect((await rows<J>(`select has_function_privilege('anon', 'public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text, text, boolean)', 'execute') as ok`))[0].ok).toBe(false)
    // the new helpers and the cores 0755 rewrote are not doors: no browser role can run them
    for (const f of ['dpdp.ensure_account(text, text)', 'dpdp.account_charge_paise(dpdp.account, text, integer)', 'dpdp.account_monthly_total_paise(dpdp.account, integer)', 'dpdp.account_pack_available(dpdp.account)',
      'dpdp.account_client_cap(dpdp.account)', 'public.dpdp__open_account_core(text, text, text, text, text, text, text, timestamptz, text)', 'public.dpdp__pay_begin_core(text, text)', 'public.dpdp__declare_payment_core(text, integer, text, text, text, text)'])
      for (const role of ['anon', 'authenticated']) expect((await rows<J>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, f]))[0].ok, `${role} on ${f}`).toBe(false)
    expect((await rows<J>(`select has_function_privilege('anon', 'public.dpdp_public_plans()', 'execute') as ok`))[0].ok).toBe(true)
    expect((await rows<J>(`select has_function_privilege('anon', 'public.dpdp_unsubscribe(text)', 'execute') as ok`))[0].ok).toBe(true)
  })

  test('every event this flow wrote, across every test above, carries no e-mail address and no organisation name', async () => {
    const kinds = ['account_opened', 'firm_verification_requested', 'firm_verification_verified', 'firm_verification_rejected', 'plan_chosen', 'client_added', 'account_marked_paid',
      'billing_email_unsubscribed', 'final_download_notice_sent', 'breach_recorded', 'grievance_answered']
    const ev = await rows<J>(`select kind, summary, detail, actor_label from dpdp.event where kind = any($1)`, [kinds])
    expect(ev.length).toBeGreaterThan(20)
    for (const e of ev) {
      const text = [e.summary, e.detail ?? '', e.actor_label].join(' | ')
      expect(text, e.kind).not.toMatch(/@/)
      expect(text, e.kind).not.toMatch(/Org \d|Linked client|Follower|Pick/)
    }
    // none of those events ever names a person as the actor label: only a role
    expect([...new Set(ev.map((e) => e.actor_label))].sort()).toEqual(['A billing contact', 'Firm', 'Member', 'Owner', 'Platform owner', 'System'])
  })

  test('every plan or price change by the owner is written down, and only the platform owner can make one', async () => {
    await as('someone@else.test')
    await expect(db.query(`select public.dpdp_owner_update_plan('institution', 90000)`)).rejects.toThrow(/Owner only/)
    await as('admin@veridian.test')
    await expect(db.query(`select public.dpdp_owner_update_plan('institution', 100, 200)`)).rejects.toThrow() // offer above list: the table refuses
    await expect(db.query(`select public.dpdp_owner_update_plan('nope', 1)`)).rejects.toThrow(/No such plan/)
    await db.query(`select public.dpdp_owner_update_plan('institution', 109900, 109900)`)
    expect((await rows<J>(`select list_monthly_paise from dpdp.plan where key = 'institution'`))[0].list_monthly_paise).toBe(109900)
    expect((await rows<J>(`select 1 from dpdp.partner_event where kind = 'plan_updated' and detail = 'institution'`)).length).toBe(1)
    await db.query(`select public.dpdp_owner_update_plan('institution', 99900, 99900)`)
  })
})
