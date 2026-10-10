/// <reference types="bun-types" />
// DPDP account opening, plans, firm verification and the billing state machine (drizzle/0734_dpdp_account_opening_plans_billing.sql).
// Offline proof on PGlite (real Postgres as WASM): the live database is never touched. The WHOLE migration file is executed, not copies of its
// functions, on top of stand-in base tables. The older functions it builds on (caller identity/membership, the event writer, the money function,
// the owner check, the partner notice) are copied out of their own migration files at run time, so a change to them is seen here.
//
// Four things are stand-ins and say so: dpdp_create_my_org and the original dpdp_create_client_org (their own tests live elsewhere; here they
// create just enough and record the referral code they were handed), and the three money RPCs' originals (they call the gate, which is what the
// allow flag has to get past).
//
// What this pins: the state machine at every boundary and against the browser's copy (dpdp-app/src/lib/billing-state.ts); the plan price an
// account signs up at and keeps (offer window, partner code, no price below the offer without the owner); the client cap; firm verification
// (owner-only, audited, free only when verified); the lock (working screens and the AI link refuse, the always-open actions work, a payment
// unlocks); the partner commission (50% of the price actually paid, first 12 months); the billing e-mail worklist (opt-outs, weekly, final
// download); and that none of the events this flow writes carries an e-mail address.
//
// Run: bun test --isolate src/lib/services/dpdp-account-billing.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, read } from './dpdp-pglite-base'
import { billingState, dueLine, finalDownloadDue, periodEnd, DEFAULT_BILLING_SETTINGS } from '../../../dpdp-app/src/lib/billing-state'

const F0733 = 'drizzle/0733_dpdp_visitor_journey.sql'
const F0734 = 'drizzle/0734_dpdp_account_opening_plans_billing.sql'
const F0735 = 'drizzle/0735_dpdp_test_live_mode_profile_capture.sql'

let db: PGlite
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(email ? { email } : {})])
type J = Record<string, any>
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
const DAY = 86_400_000
const ago = (days: number) => iso(new Date(Date.now() - days * DAY))
let n = 0
/** The offer on the institution plan ends yesterday (new sign-ups pay the list price); restoreOffer puts it back to a long window. */
const endOffer = () => db.query(`update dpdp.plan set offer_starts_on = date '2020-01-01', offer_ends_on = current_date - 1 where key = 'institution'`)
const restoreOffer = () => db.query(`update dpdp.plan set offer_starts_on = date '2026-10-06', offer_ends_on = date '2099-12-31' where key = 'institution'`)

/** A fresh owner (identity, e-mail) with an account opened through the real dpdp_open_account. Returns the org id. */
async function openAccount(kind: 'firm' | 'institution', extra: Partial<{ body: string; reg: string; ref: string; sp: string; tag: string; seen: string; billing: string }> = {}) {
  const email = `owner${++n}@acct.test`
  await as(email)
  const r = await one<J>(`select public.dpdp_open_account($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`, [kind, `Org ${n}`, extra.body ?? null, extra.reg ?? null, extra.ref ?? null, extra.sp ?? null, extra.tag ?? null, extra.seen ?? null, extra.billing ?? null])
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
  await db.query(`insert into dpdp.platform_admin (email) values ('admin@veridian.test')`)
  await db.query(`insert into dpdp.identity (id, primary_email) values ('i_admin', 'admin@veridian.test')`)
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_admin', 'i_admin', 'admin@veridian.test', true)`)
}, 180_000)

describe('the migration file itself', () => {
  test('runs a second time without error (every statement is re-runnable, and the renames are guarded)', async () => {
    await db.exec(read(F0734))
    await db.exec(read(F0735))
    expect((await rows(`select to_regprocedure('public.dpdp__my_billing_core(text)') is not null as ok`))[0].ok).toBe(true)
    expect((await rows(`select to_regprocedure('public.dpdp__create_client_org_core(text, text, text)') is not null as ok`))[0].ok).toBe(true)
    // the wrapper is still the public name (a re-run did not rename it onto the core)
    expect((await rows(`select prosrc like '%allow_locked%' as ok from pg_proc where proname = 'dpdp_my_billing'`))[0].ok).toBe(true)
  })

  test('seeds the plans exactly as the Owner gave them (list and offer, per month, paise)', async () => {
    const plans = await rows<J>(`select key, account_type, max_clients, list_monthly_paise, offer_monthly_paise, requires_verified from dpdp.plan order by sort_order`)
    expect(plans.map((p) => [p.key, p.account_type, p.max_clients, p.list_monthly_paise, p.offer_monthly_paise, p.requires_verified])).toEqual([
      ['institution', 'institution', 0, 80100, 39900, false],
      ['firm_free', 'firm', 0, 0, 0, true],
      ['firm_starter', 'firm', 10, 80100, 39900, false],
      ['firm_growth', 'firm', 100, 200100, 99900, false],
      ['firm_practice', 'firm', 500, 400100, 199900, false],
      ['firm_large', 'firm', 1000, 600100, 299900, false],
    ])
    const s = (await rows<J>(`select * from dpdp.billing_setting`))[0]
    expect([s.trial_days, s.due_days, s.grace_days, s.yearly_months_charged, Number(s.commission_percent), s.commission_months, s.attribution_window_days]).toEqual([30, 1, 7, 10, 50, 12, 30])
  })

  test('the plans are public: dpdp_public_plans answers anon and shows the offer wording, never "discount applied"', async () => {
    const plans = await one<J[]>(`select public.dpdp_public_plans() as r`)
    expect(plans.length).toBe(6)
    const inst = plans.find((p) => p.key === 'institution')!
    expect(inst.monthlyPaise).toBe(39900)
    expect(inst.listMonthlyPaise).toBe(80100)
    expect(inst.offerLabel).toBe('Festive offer: 50% off')
    expect(JSON.stringify(plans).toLowerCase()).not.toContain('discount')
    expect(plans.find((p) => p.key === 'firm_free')!.offerLabel).toBeNull()
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
  test('an institution: owner membership, the account row, the offer price locked in, nothing paid, no payment row', async () => {
    const { orgId, r } = await openAccount('institution')
    expect(r).toMatchObject({ ok: true, accountType: 'institution', planKey: 'institution', monthlyPaise: 39900, listMonthlyPaise: 80100, offerActive: true, attribution: 'none', verification: 'none' })
    const a = await account(orgId)
    expect(a).toMatchObject({ account_type: 'institution', plan_key: 'institution', locked_monthly_paise: 39900, verification_status: 'none', paid_until: null })
    expect((await rows(`select 1 from dpdp.payment where org_id = $1`, [orgId])).length).toBe(0)
    expect(await stateOf(orgId)).toBe('TRIAL')
  })

  test('a firm opens on Starter (up to 10 clients) at the offer price, NOT free, whatever it says about itself', async () => {
    const { orgId, r } = await openAccount('firm')
    expect(r.planKey).toBe('firm_starter')
    expect((await account(orgId)).locked_monthly_paise).toBe(39900)
  })

  test('professional details at opening are optional and never block: stored when they fit, left out when they do not, never "pending", never an event about checking', async () => {
    const { orgId, r } = await openAccount('firm', { body: 'ICAI', reg: '123456/W100' })
    expect(r.verification).toBe('none')
    expect(await account(orgId)).toMatchObject({ professional_body: 'ICAI', registration_no: '123456/W100', verification_status: 'none' })
    await as('bad@acct.test')
    for (const args of ["'ICAI', null", "'BAR', '123456'", "'ICSI', 'a;drop table'"] as const) {
      const out = await one<J>(`select public.dpdp_open_account('firm', 'X', ${args}) as r`)
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
    await expect(db.query(`select public.dpdp_open_account('hospital', 'X')`)).rejects.toThrow(/Choose whether/)
  })

  test('once the offer window has ended a NEW sign-up pays the list price; an account that signed up earlier keeps what it signed up at', async () => {
    const early = await openAccount('institution')
    await endOffer()
    const late = await openAccount('institution')
    expect((await account(late.orgId)).locked_monthly_paise).toBe(80100)
    expect(late.r.offerActive).toBe(false)
    expect((await account(early.orgId)).locked_monthly_paise).toBe(39900)
    await as(early.email)
    const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [early.orgId])
    expect(mine.money.monthlyPaise).toBe(39900) // what the account shows the owner is what it signed up at, not today's list price
    await restoreOffer()
  })

  test('the yearly price is ten months of the monthly price actually signed up at', async () => {
    const { email, orgId } = await openAccount('institution')
    await as(email)
    const mine = await one<J>(`select public.dpdp_my_account($1) as r`, [orgId])
    expect(mine.money).toMatchObject({ monthPaise: 39900, yearPaise: 399000, offerLabel: 'Festive offer: 50% off' })
  })

  test('a double click returns the same account and does not open a second one', async () => {
    const { email, orgId } = await openAccount('institution')
    await as(email)
    const before = (await rows(`select count(*)::int as c from dpdp.account`))[0].c
    // the stand-in sign-up never answers "existing"; make it do so for this one call, as the real function does for a repeat within 10 minutes
    const stub = BASE_SQL.match(/create function public\.dpdp_create_my_org[\s\S]*?end \$f\$;/)![0].replace('create function', 'create or replace function')
    try {
      await db.query(`create or replace function public.dpdp_create_my_org(p_name text, p_product text, p_referral_code text default null) returns jsonb language sql as $f$ select jsonb_build_object('ok', true, 'orgId', '${orgId}', 'existing', true) $f$`)
      const again = await one<J>(`select public.dpdp_open_account('institution', 'Org', null, null, null, null, null, null, null) as r`)
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
    const r = await one<J>(`select public.dpdp_open_account('institution', 'Own', null, null, null, 'PARTNER3') as r`)
    expect((await account(r.orgId)).attributed_identity_id).toBeNull()
    expect(partner).toBeTruthy()
  })

  test('a partner code applies the active offer and tags the sale; it never goes below the offer without the Owner (extra percent needs approval)', async () => {
    const partner = await addPartner('p4', 'PARTNER4')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_set_partner_code($1, 'FEST4', 0, true)`, [partner])
    const plain = await openAccount('institution', { sp: 'FEST4' })
    expect((await account(plain.orgId)).locked_monthly_paise).toBe(39900) // exactly the offer, no lower
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
    expect((await account(approved.orgId)).locked_monthly_paise).toBe(Math.round(39900 * 0.9))
    const other = await openAccount('institution')
    expect((await account(other.orgId)).locked_monthly_paise).toBe(39900)
  })

  test('a partner code that is not active, or whose partner is not active, is ignored (the sign-up still works, at the offer)', async () => {
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

describe('self-declared firms: no owner verification, free is the practitioner declaration, the owner may downgrade', () => {
  const declare = (v: boolean) => db.query(`select public.dpdp_account_save_profile($1::jsonb)`, [JSON.stringify({ practitionerDeclared: v })])

  test('the owner-verifies gate is gone: its three functions no longer exist', async () => {
    for (const f of ['dpdp_owner_verify_firm', 'dpdp_owner_pending_verifications', 'dpdp_account_set_professional']) {
      expect((await rows(`select 1 from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [f])).length, f).toBe(0)
    }
  })

  test('a firm that gives a professional body and number at opening is NOT on the free plan until it ticks the declaration', async () => {
    const { orgId, r } = await openAccount('firm', { body: 'ICAI', reg: '123456/W100' })
    expect(r.verification).toBe('none')
    expect(await account(orgId)).toMatchObject({ professional_body: 'ICAI', registration_no: '123456/W100', verification_status: 'none', plan_key: 'firm_starter', locked_monthly_paise: 39900 })
    expect((await rows(`select 1 from dpdp.event where org_id = $1 and kind like 'firm_verification%'`, [orgId])).length).toBe(0)
  })

  test('the declaration is the free own-use plan at once: audited without the number or any e-mail, free for ever, and it can be withdrawn', async () => {
    const { email, orgId } = await openAccount('firm', { body: 'ICMAI', reg: 'CMA-99887' })
    await as(email)
    await expect(db.query(`select public.dpdp_account_choose_plan('firm_free')`)).rejects.toThrow(/practising CA, CS and cost accountants/)
    const r = await one<J>(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb) as r`)
    expect(r).toMatchObject({ ok: true, status: 'declared', planKey: 'firm_free' })
    expect(await account(orgId)).toMatchObject({ verification_status: 'declared', plan_key: 'firm_free', locked_monthly_paise: 0 })
    const ev = await rows<J>(`select kind, summary, detail from dpdp.event where org_id = $1 and kind in ('firm_self_declared', 'plan_chosen')`, [orgId])
    expect(ev.map((e) => e.kind).sort()).toEqual(['firm_self_declared', 'plan_chosen'])
    expect(JSON.stringify(ev)).not.toMatch(/CMA-99887|@/)
    expect(await stateOf(orgId)).toBe('ACTIVE')
    await setClock(orgId, 400, null) // active for ever, even with the clock far past the trial
    expect(await stateOf(orgId)).toBe('ACTIVE')
    await db.query(`select public.t_work()`) // and its working screens open
    await declare(false)
    expect(await account(orgId)).toMatchObject({ verification_status: 'none', plan_key: 'firm_starter', locked_monthly_paise: 39900 })
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

  test('a declaration needs a firm account, and a firm with clients keeps its plan', async () => {
    const inst = await openAccount('institution')
    await as(inst.email)
    const r = await one<J>(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb) as r`)
    expect(r.ignored).toContain('practitionerDeclared')
    expect((await account(inst.orgId)).verification_status).toBe('none')
    const f = await openAccount('firm')
    await as(f.email)
    await db.query(`select public.dpdp_create_client_org('A client', 'dpdp')`)
    const r2 = await one<J>(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb, $1) as r`, [f.orgId])
    expect(r2).toMatchObject({ status: 'declared', planKey: 'firm_starter' })
    expect(r2.note).toMatch(/own file, with no clients/)
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
    expect(list.find((x) => x.orgId === orgId)).toMatchObject({ status: 'declared', professionalBody: 'ICAI', registrationNo: '445566', formatOk: true, planKey: 'firm_free', isTest: false })
  })

  test('downgrade to paid: audited, back on Starter at today\'s price, and the firm cannot declare itself free again', async () => {
    const { email, orgId } = await openAccount('firm', { body: 'ICAI', reg: '000111' })
    await as(email)
    await declare(true)
    await as('admin@veridian.test')
    const r = await one<J>(`select public.dpdp_owner_downgrade_firm($1, 'abuse review') as r`, [orgId])
    expect(r).toMatchObject({ ok: true, status: 'downgraded', planKey: 'firm_starter' })
    expect(await account(orgId)).toMatchObject({ verification_status: 'downgraded', plan_key: 'firm_starter', locked_monthly_paise: 39900 })
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

  test('"free" is decided by the declaration plus a free plan, not by the plan name alone', async () => {
    const { orgId } = await openAccount('firm')
    await db.query(`update dpdp.account set plan_key = 'firm_free', locked_monthly_paise = 0 where org_id = $1`, [orgId]) // forced: no declaration
    await setClock(orgId, 100, null)
    expect(await stateOf(orgId)).toBe('LOCKED')
    await db.query(`update dpdp.account set verification_status = 'declared' where org_id = $1`, [orgId])
    expect(await stateOf(orgId)).toBe('ACTIVE')
    await db.query(`update dpdp.account set verification_status = 'downgraded' where org_id = $1`, [orgId])
    expect(await stateOf(orgId)).toBe('LOCKED')
  })
})

describe('the client cap, enforced on the server when a firm adds a client organisation', () => {
  const addClient = (name = 'Client') => db.query(`select public.dpdp_create_client_org($1, 'institution')`, [name])
  const used = async (firm: string) => (await rows<J>(`select count(*)::int as c from dpdp.account_client where firm_org_id = $1`, [firm]))[0].c as number

  test('Starter covers 10: the 11th is refused in calm words, and nothing is created for it', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    for (let i = 1; i <= 10; i++) await addClient(`C${i}`)
    expect(await used(orgId)).toBe(10)
    const before = (await rows<J>(`select count(*)::int as c from public.t_core_client_calls`))[0].c
    await expect(addClient('C11')).rejects.toThrow(/Your plan covers up to 10 client organisations\. To add more, choose a bigger plan\./)
    expect((await rows<J>(`select count(*)::int as c from public.t_core_client_calls`))[0].c).toBe(before) // the real creator was never reached
    expect(await used(orgId)).toBe(10)
  })

  test('a bigger plan lifts it; a plan smaller than the clients already managed is refused', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    for (let i = 1; i <= 10; i++) await addClient(`D${i}`)
    await db.query(`select public.dpdp_account_choose_plan('firm_growth', 'month', $1)`, [orgId])
    await addClient('D11')
    expect(await used(orgId)).toBe(11)
    await expect(db.query(`select public.dpdp_account_choose_plan('firm_starter', 'month', $1)`, [orgId])).rejects.toThrow(/You manage 11 client organisations, and this plan covers up to 10/)
    await expect(db.query(`select public.dpdp_account_choose_plan('institution', 'month', $1)`, [orgId])).rejects.toThrow(/not available for this kind of account/)
    await expect(db.query(`select public.dpdp_account_choose_plan('nope', 'month', $1)`, [orgId])).rejects.toThrow(/not available/)
  })

  test('the cap of every rung is the one in the table (10, 100, 500, 1000) and Free is zero', async () => {
    const caps = await rows<J>(`select key, max_clients from dpdp.plan where account_type = 'firm' order by max_clients`)
    expect(caps.map((c) => [c.key, c.max_clients])).toEqual([['firm_free', 0], ['firm_starter', 10], ['firm_growth', 100], ['firm_practice', 500], ['firm_large', 1000]])
  })

  test('Free means zero clients, even for a declared practitioner', async () => {
    const { email, orgId } = await openAccount('firm', { body: 'ICAI', reg: '135790' })
    await as(email)
    await db.query(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb)`)
    expect((await account(orgId)).plan_key).toBe('firm_free')
    await expect(addClient()).rejects.toThrow(/Your plan is for your own firm's file/)
    expect(await used(orgId)).toBe(0)
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
    expect((await one<J>(`select public.dpdp_pay_begin('year') as r`)).orgId).toBe(orgId)
    const mine = await one<J>(`select public.dpdp_my_account() as r`)
    expect(mine).toMatchObject({ state: 'LOCKED', money: { monthPaise: 39900 } })
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

  test('marking paid unlocks, books exactly one payment at the price the account signed up at, and is audited without a figure or an address', async () => {
    const { email, orgId } = await openAccount('institution')
    await setClock(orgId, 100, null)
    await as('admin@veridian.test')
    const r = await one<J>(`select public.dpdp_owner_mark_paid($1, 'month', null, null, 'UTR 998877', 'bank transfer') as r`, [orgId])
    expect(r.ok).toBe(true)
    const pay = await rows<J>(`select plan, "interval", amount_paise, confirmed_note from dpdp.payment where org_id = $1`, [orgId])
    expect(pay).toEqual([{ plan: 'institution', interval: 'month', amount_paise: 39900, confirmed_note: 'Ref UTR 998877. bank transfer' }])
    expect(await stateOf(orgId)).toBe('ACTIVE')
    await as(email)
    await db.query(`select public.t_work()`)
    const ev = await rows<J>(`select kind, summary, detail, actor_label from dpdp.event where org_id = $1 and kind = 'account_marked_paid'`, [orgId])
    expect(ev.length).toBe(1)
    expect(JSON.stringify(ev)).not.toMatch(/@|39900|UTR/)
  })

  test('paid-until: a month from now when it had lapsed; from the END of the trial when paid during the trial; a year is twelve months for ten months\' price', async () => {
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
    expect((await rows<J>(`select amount_paise from dpdp.payment where org_id = $1`, [c.orgId]))[0].amount_paise).toBe(399000)
    expect(days(new Date((await account(c.orgId)).paid_until + 'Z'))).toBeGreaterThan(30 + 364)
  })

  test('an explicit paid-until date overrides the working-out', async () => {
    const { orgId } = await openAccount('institution')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month', null, date '2031-06-30')`, [orgId])
    expect((await rows<J>(`select to_char(paid_until, 'YYYY-MM-DD') as d from dpdp.account where org_id = $1`, [orgId]))[0].d).toBe('2031-06-30')
  })

  test('refusals: a bad interval, an unknown account, a free account with nothing to pay', async () => {
    const { orgId } = await openAccount('institution')
    await as('admin@veridian.test')
    await expect(db.query(`select public.dpdp_owner_mark_paid($1, 'week')`, [orgId])).rejects.toThrow(/interval must be/)
    await expect(db.query(`select public.dpdp_owner_mark_paid('nope', 'month')`)).rejects.toThrow(/No such account/)
    await db.query(`update dpdp.account set plan_key = 'firm_free', account_type = 'firm', locked_monthly_paise = 0 where org_id = $1`, [orgId])
    await expect(db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])).rejects.toThrow(/nothing to pay/)
  })

  test('a payment that arrives while LOCKED re-prices the account to today\'s plan price; one that arrives while active keeps the price it signed up at', async () => {
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
    await restoreOffer()
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

  test('a first payment earns 50% of the price actually paid (the offer price, not the list price)', async () => {
    const partner = await addPartner('c1', 'COMM0001')
    const { orgId } = await openAccount('institution', { sp: 'COMM0001' })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    expect(await commissions(orgId)).toEqual([{ base_paise: 39900, amount_paise: 19950, rate_percent: '50.00' }])
    const notices = await rows<J>(`select kind, payload from dpdp.partner_notice where identity_id = $1 and kind = 'commission_earned'`, [partner])
    expect(notices.length).toBe(1)
    expect(notices[0].payload).toEqual({ amountPaise: 19950, basis: 'monthly_first_year' })
  })

  test('a yearly payment earns 50% of the ten-month price', async () => {
    await addPartner('c2', 'COMM0002')
    const { orgId } = await openAccount('institution', { sp: 'COMM0002' })
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'year')`, [orgId])
    expect(await commissions(orgId)).toEqual([{ base_paise: 399000, amount_paise: 199500, rate_percent: '50.00' }])
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

  test('commission follows the price that was charged: an owner-approved partner code that went below the offer earns on the lower price', async () => {
    const partner = await addPartner('c4', 'COMM0004')
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_set_partner_code($1, 'LOW0004', 20, true)`, [partner])
    const { orgId } = await openAccount('institution', { sp: 'LOW0004' })
    expect((await account(orgId)).locked_monthly_paise).toBe(31920)
    await as('admin@veridian.test')
    await db.query(`select public.dpdp_owner_mark_paid($1, 'month')`, [orgId])
    expect((await commissions(orgId))[0]).toMatchObject({ base_paise: 31920, amount_paise: 15960 })
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
    for (const f of ['public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text)', 'public.dpdp_my_account(text)', 'public.dpdp_locked_download(text)', 'public.dpdp_my_billing(text)', 'public.dpdp_create_client_org(text, text, text, text)'])
      expect((await rows<J>(`select has_function_privilege('authenticated', $1, 'execute') as ok`, [f]))[0].ok, f).toBe(true)
    expect((await rows<J>(`select has_function_privilege('anon', 'public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text)', 'execute') as ok`))[0].ok).toBe(false)
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
    await db.query(`select public.dpdp_owner_update_plan('institution', 85100)`)
    expect((await rows<J>(`select list_monthly_paise from dpdp.plan where key = 'institution'`))[0].list_monthly_paise).toBe(85100)
    expect((await rows<J>(`select 1 from dpdp.partner_event where kind = 'plan_updated' and detail = 'institution'`)).length).toBe(1)
    await db.query(`select public.dpdp_owner_update_plan('institution', 80100)`)
  })
})
