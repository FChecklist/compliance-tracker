/// <reference types="bun-types" />
// DPDP Test / Live mode, the offer end date, and self-declared profile capture (drizzle/0735_dpdp_test_live_mode_profile_capture.sql).
// Offline proof on PGlite: the live database is never touched. The migrations 0733, 0734 and 0735 are executed whole, on the shared stand-in base
// (dpdp-pglite-base.ts).
//
// What this pins: the mode table and who may change it (owner only, never anon / service role, every switch audited); that everything created in
// TEST is flagged and stays flagged; the e-mail gate (allowlist, suppression log without the address, the TypeScript rule equals the SQL rule);
// the Test payment (refuses in LIVE and on real accounts, moves paid-until through the real path, no commission, no partner notice); that test data
// is left out of the visitor report; the purge (owner only, never the audit rows, records itself); the offer end date (null, never in any output,
// owner-only setter that does not echo it); and the optional profile capture (an empty profile still works, bad values are ignored not refused).
//
// Run: bun test --isolate src/lib/services/dpdp-test-live-mode.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, read } from './dpdp-pglite-base'
import { decideMail, mailGate, SUPPRESSED_MESSAGE_ID } from '../../../supabase/functions/_shared/mail-gate'

let db: PGlite
type J = Record<string, any>
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(email ? { email } : {})])
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const ADMIN = 'admin@veridian.test'
let n = 0
const setMode = async (mode: 'TEST' | 'LIVE') => { await as(ADMIN); await db.query(`select public.dpdp_owner_set_mode($1, 'test run')`, [mode]) }
async function openAccount(kind: 'firm' | 'institution') {
  const email = `owner${++n}@mode.test`
  await as(email)
  const r = await one<J>(`select public.dpdp_open_account($1, $2) as r`, [kind, `Org ${n}`])
  return { email, orgId: r.orgId as string }
}
const account = async (orgId: string) => (await rows<J>(`select * from dpdp.account where org_id = $1`, [orgId]))[0]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  await db.exec(read('drizzle/0733_dpdp_visitor_journey.sql'))
  await db.exec(read('drizzle/0734_dpdp_account_opening_plans_billing.sql'))
  await db.exec(read('drizzle/0735_dpdp_test_live_mode_profile_capture.sql'))
  await db.query(`insert into dpdp.platform_admin (email) values ($1)`, [ADMIN])
  await db.query(`insert into dpdp.identity (id, primary_email) values ('i_admin', $1)`, [ADMIN])
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_admin', 'i_admin', $1, true)`, [ADMIN])
  await db.exec(`insert into dpdp.mail_allowlist (email_lower, note) values ('admin@veridian.test', 'owner') on conflict do nothing`)
}, 180_000)

describe('the mode: one row, owner only, always audited', () => {
  test('it starts as LIVE and anyone, even anonymous, can read it', async () => {
    await as('')
    expect(await one<J>(`select public.dpdp_platform_mode() as r`)).toEqual({ mode: 'LIVE', test: false })
  })

  test('a signed-in non-owner, an anonymous caller and the service role cannot switch it', async () => {
    const { email } = await openAccount('firm')
    for (const who of [email, '']) {
      await as(who)
      await expect(db.query(`select public.dpdp_owner_set_mode('TEST', 'x')`)).rejects.toThrow(/Owner only/)
    }
    // not executable at all by anon or service_role (the AI link runs as the service role)
    for (const role of ['anon', 'service_role', 'public']) {
      const ok = (await rows<J>(`select has_function_privilege($1, 'public.dpdp_owner_set_mode(text, text)', 'execute') as ok`, [role]))[0].ok
      expect(ok, role).toBe(false)
    }
    expect((await one<J>(`select public.dpdp_platform_mode() as r`)).mode).toBe('LIVE')
  })

  test('the owner switches it; a bad value is refused; a no-op changes nothing; every real switch is in the append-only audit', async () => {
    await as(ADMIN)
    await expect(db.query(`select public.dpdp_owner_set_mode('MAYBE')`)).rejects.toThrow(/TEST or LIVE/)
    const before = (await rows(`select 1 from dpdp.audit_platform_event where kind = 'mode_switch'`)).length
    expect(await one<J>(`select public.dpdp_owner_set_mode('live') as r`)).toMatchObject({ changed: false })
    expect(await one<J>(`select public.dpdp_owner_set_mode('test', 'trying the flow') as r`)).toMatchObject({ ok: true, mode: 'TEST', changed: true })
    expect(await one<J>(`select public.dpdp_platform_mode() as r`)).toEqual({ mode: 'TEST', test: true })
    const row = (await rows<J>(`select * from dpdp.platform_mode`))[0]
    expect(row).toMatchObject({ mode: 'TEST', reason: 'trying the flow', changed_by: 'i_admin' })
    const audit = await rows<J>(`select detail from dpdp.audit_platform_event where kind = 'mode_switch' order by id desc limit 1`)
    expect(audit[0].detail).toMatchObject({ from: 'LIVE', to: 'TEST', via: 'owner_rpc' })
    expect((await rows(`select 1 from dpdp.audit_platform_event where kind = 'mode_switch'`)).length).toBe(before + 1)
    // a change made straight in SQL is audited too
    await db.query(`update dpdp.platform_mode set mode = 'LIVE' where id = 1`)
    expect((await rows<J>(`select detail from dpdp.audit_platform_event where kind = 'mode_switch' order by id desc limit 1`))[0].detail).toMatchObject({ from: 'TEST', to: 'LIVE', via: 'direct_sql' })
    // the audit trail itself cannot be edited or emptied
    await expect(db.query(`update dpdp.audit_platform_event set kind = 'x'`)).rejects.toThrow(/append-only/)
    await expect(db.query(`delete from dpdp.audit_platform_event`)).rejects.toThrow(/append-only/)
    await expect(db.query(`truncate dpdp.audit_platform_event`)).rejects.toThrow(/append-only/)
  })
})

describe('what is created in TEST is flagged, and stays flagged', () => {
  test('organisation, identity, account and payment carry the flag; a LIVE one never does; switching back does not unflag', async () => {
    await setMode('LIVE')
    const real = await openAccount('institution')
    await setMode('TEST')
    const t = await openAccount('firm')
    expect((await rows(`select 1 from dpdp.test_org where org_id = $1`, [t.orgId])).length).toBe(1)
    expect((await rows(`select 1 from dpdp.test_org where org_id = $1`, [real.orgId])).length).toBe(0)
    expect((await account(t.orgId)).is_test).toBe(true)
    expect((await account(real.orgId)).is_test).toBe(false)
    expect((await rows(`select 1 from dpdp.test_identity ti join dpdp.identity_email ie on ie.identity_id = ti.identity_id where ie.email = $1`, [t.email])).length).toBe(1)
    await setMode('LIVE')
    expect((await account(t.orgId)).is_test).toBe(true)
    expect(await one<boolean>(`select dpdp.org_is_test($1) as r`, [t.orgId])).toBe(true)
  })
})

describe('e-mail in TEST mode goes only to the allowlist', () => {
  test('TEST: the owner is mailed, everyone else is suppressed and logged WITHOUT the address; LIVE: everyone is mailed', async () => {
    await setMode('TEST')
    await as('')
    const gate = (to: string, src = 'dpdp-monday-email') => one<J>(`select public.dpdp_mail_gate($1, $2) as r`, [to, src])
    expect(await gate('Admin@Veridian.test')).toEqual({ send: true, reason: 'allowlisted', mode: 'TEST' })
    expect(await gate('someone.real@customer.example')).toEqual({ send: false, reason: 'suppressed_test_mode', mode: 'TEST' })
    const log = await rows<J>(`select * from dpdp.mail_suppressed_log where source = 'dpdp-monday-email'`)
    expect(log.length).toBe(1)
    expect(log[0]).toMatchObject({ reason: 'suppressed_test_mode', to_domain: 'customer.example' })
    expect(JSON.stringify(log)).not.toContain('someone.real')
    await setMode('LIVE')
    expect(await gate('someone.real@customer.example')).toEqual({ send: true, reason: 'live', mode: 'LIVE' })
  })

  test('in LIVE a test account\'s contact is never mailed, unless the owner put the address on the allowlist', async () => {
    await setMode('TEST')
    const t = await openAccount('institution')
    await setMode('LIVE')
    await as('')
    expect(await one<J>(`select public.dpdp_mail_gate($1, 'x') as r`, [t.email])).toMatchObject({ send: false, reason: 'suppressed_test_account' })
    await as(ADMIN)
    await db.query(`select public.dpdp_owner_mail_allowlist('add', $1, 'my second test inbox')`, [t.email])
    await as('')
    expect(await one<J>(`select public.dpdp_mail_gate($1, 'x') as r`, [t.email])).toMatchObject({ send: true, reason: 'live' })
  })

  test('the allowlist is owner-managed and audited, never empty, and the suppression log is owner-only', async () => {
    const { email } = await openAccount('firm')
    for (const who of [email, '']) {
      await as(who)
      await expect(db.query(`select public.dpdp_owner_mail_allowlist('list')`)).rejects.toThrow(/Owner only/)
      await expect(db.query(`select public.dpdp_owner_suppressed_mail()`)).rejects.toThrow(/Owner only/)
    }
    await as(ADMIN)
    await expect(db.query(`select public.dpdp_owner_mail_allowlist('add', 'not-an-address')`)).rejects.toThrow(/looks wrong/)
    const added = await one<J>(`select public.dpdp_owner_mail_allowlist('add', 'Second@Owner.test') as r`)
    expect(added.addresses.map((a: J) => a.email)).toContain('second@owner.test')
    await db.query(`select public.dpdp_owner_mail_allowlist('remove', 'second@owner.test')`)
    await db.query(`delete from dpdp.mail_allowlist where email_lower <> $1`, [ADMIN])
    await expect(db.query(`select public.dpdp_owner_mail_allowlist('remove', $1)`, [ADMIN])).rejects.toThrow(/at least one address/)
    expect((await rows(`select 1 from dpdp.audit_platform_event where kind in ('mail_allowlist_added', 'mail_allowlist_removed')`)).length).toBeGreaterThanOrEqual(2)
    expect((await one<J[]>(`select public.dpdp_owner_suppressed_mail() as r`)).length).toBeGreaterThan(0)
  })

  test('the TypeScript rule used by the Edge Functions is the SQL rule, for all eight inputs', async () => {
    for (const t of [true, false]) for (const a of [true, false]) for (const r of [true, false]) {
      expect(decideMail(t, a, r), `${t} ${a} ${r}`).toBe((await one<string>(`select dpdp.mail_decision($1, $2, $3) as r`, [t, a, r])) as unknown as string)
    }
  })

  test('mailGate asks the database, returns its answer, and THROWS when it cannot be reached (a mail never leaves unchecked)', async () => {
    const deps = (res: () => Response) => ({ url: 'https://x.test/', key: 'k', fetchImpl: async () => res() })
    expect(await mailGate('a@b.in', 'f', deps(() => new Response(JSON.stringify({ send: false, reason: 'suppressed_test_mode', mode: 'TEST' })))))
      .toMatchObject({ send: false })
    await expect(mailGate('a@b.in', 'f', deps(() => new Response('no', { status: 503 })))).rejects.toThrow(/503/)
    await expect(mailGate('a@b.in', 'f', deps(() => new Response('{}', { status: 200 })))).rejects.toThrow(/no answer/)
    await expect(mailGate('a@b.in', 'f', { fetchImpl: async () => new Response('{}') })).rejects.toThrow(/not configured/)
    expect(SUPPRESSED_MESSAGE_ID).toBe('suppressed_test_mode')
  })
})

describe('the Test payment', () => {
  test('it refuses in LIVE mode and on a real account', async () => {
    await setMode('LIVE')
    const live = await openAccount('institution')
    await as(live.email)
    await expect(db.query(`select public.dpdp_test_payment('month')`)).rejects.toThrow(/only available while the platform is in Test mode/)
    await setMode('TEST')
    await as(live.email)
    await expect(db.query(`select public.dpdp_test_payment('month')`)).rejects.toThrow(/only be recorded on a test account/)
    expect((await rows(`select 1 from dpdp.payment where org_id = $1`, [live.orgId])).length).toBe(0)
  })

  test('on a test account it moves paid-until through the real path, is flagged, earns no commission and sends no partner notice', async () => {
    await setMode('LIVE')
    const pid = 'i_partner_t'
    await db.query(`insert into dpdp.identity (id, primary_email) values ($1, 'p@partner.test')`, [pid])
    await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ('ie_pt', $1, 'p@partner.test', true)`, [pid])
    await db.query(`insert into dpdp.sales_partner (identity_id, status) values ($1, 'active')`, [pid])
    await db.query(`insert into dpdp.referral (identity_id, code) values ($1, 'TESTREF1')`, [pid])
    await setMode('TEST')
    const email = `owner${++n}@mode.test`
    await as(email)
    const opened = await one<J>(`select public.dpdp_open_account('institution', 'Partnered', null, null, null, 'TESTREF1') as r`)
    expect(await account(opened.orgId)).toMatchObject({ source_kind: 'partner', is_test: true })
    expect((await rows(`select 1 from dpdp.partner_notice where kind = 'referred_signup'`)).length).toBe(0)
    const paid = await one<J>(`select public.dpdp_test_payment('month') as r`)
    expect(paid).toMatchObject({ ok: true, test: true })
    const a = await account(opened.orgId)
    expect(a.paid_until).not.toBeNull()
    expect(a.first_paid_at).not.toBeNull()
    expect(await rows<J>(`select is_test, confirmed_note from dpdp.payment where org_id = $1`, [opened.orgId])).toEqual([{ is_test: true, confirmed_note: 'Test payment (no money moved)' }])
    expect((await rows(`select 1 from dpdp.account_commission where org_id = $1`, [opened.orgId])).length).toBe(0)
    expect((await rows(`select 1 from dpdp.partner_notice where kind = 'commission_earned'`)).length).toBe(0)
    expect((await rows(`select 1 from dpdp.referral_commission`)).length).toBe(0)
    // a non-owner of the account cannot record one
    await as('stranger@mode.test')
    await expect(db.query(`select public.dpdp_test_payment('month', $1)`, [opened.orgId])).rejects.toThrow(/Not a member/)
  })
})

describe('test data is left out of the reports', () => {
  test('the visitor report and funnel take a mode, default live', async () => {
    await setMode('LIVE')
    await db.query(`insert into dpdp.visit_session (id, visitor_id) values ('s_live', 'aaaaaaaaaaaaaaaaaaaa')`)
    await setMode('TEST')
    await db.query(`insert into dpdp.visit_session (id, visitor_id) values ('s_test1', 'bbbbbbbbbbbbbbbbbbbb'), ('s_test2', 'cccccccccccccccccccc')`)
    await setMode('LIVE')
    const total = async (mode?: string) => (await one<J>(mode ? `select public.dpdp_visit_report(30, $1) as r` : `select public.dpdp_visit_report(30) as r`, mode ? [mode] : [])).totals.human_sessions
    expect(await total()).toBe(1)
    expect(await total('live')).toBe(1)
    expect(await total('test')).toBe(2)
    expect(await total('all')).toBe(3)
    await expect(db.query(`select public.dpdp_visit_report(30, 'bogus')`)).rejects.toThrow(/live, test or all/)
    const f = await rows<J>(`select sum(visits)::int as v from dpdp.visit_funnel(now() - interval '1 day', now() + interval '1 day')`)
    expect(f[0].v).toBe(1)
  })

  test('the billing e-mail worklist and the owner\'s lists leave test accounts out; the declared-firms list takes a mode', async () => {
    await setMode('TEST')
    const t = await openAccount('firm')
    await as(t.email)
    await db.query(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb)`)
    await setMode('LIVE')
    const r = await openAccount('firm')
    await as(r.email)
    await db.query(`select public.dpdp_account_save_profile('{"practitionerDeclared": true}'::jsonb)`)
    await db.query(`update dpdp.account set opened_at = now() - interval '400 days', plan_key = 'firm_starter', locked_monthly_paise = 39900, verification_status = 'none' where org_id = any($1)`, [[t.orgId, r.orgId]])
    await as(ADMIN)
    const w = await one<J[]>(`select public.dpdp_billing_due_worklist(now(), 500, true) as r`)
    expect(w.map((x) => x.orgId)).toContain(r.orgId)
    expect(w.map((x) => x.orgId)).not.toContain(t.orgId)
    await db.query(`update dpdp.account set verification_status = 'declared' where org_id = any($1)`, [[t.orgId, r.orgId]])
    const ids = async (m?: string) => (await one<J[]>(m ? `select public.dpdp_owner_declared_firms($1) as r` : `select public.dpdp_owner_declared_firms() as r`, m ? [m] : [])).map((x) => x.orgId)
    expect(await ids()).toContain(r.orgId)
    expect(await ids()).not.toContain(t.orgId)
    expect(await ids('test')).toEqual(expect.arrayContaining([t.orgId]))
    expect(await ids('test')).not.toContain(r.orgId)
    expect((await ids('all')).length).toBeGreaterThanOrEqual(2)
  })
})

describe('purging test data', () => {
  test('owner only and typed confirmation; deletes every test organisation and its rows; keeps real ones and every audit row; records itself', async () => {
    await setMode('LIVE')
    const real = await openAccount('firm')
    await setMode('TEST')
    const t = await openAccount('institution')
    await as(t.email)
    await db.query(`select public.dpdp_test_payment('month')`)
    await setMode('LIVE')
    const eventsBefore = (await rows(`select 1 from dpdp.event where org_id = $1`, [t.orgId])).length
    expect(eventsBefore).toBeGreaterThan(0)
    await as(t.email)
    await expect(db.query(`select public.dpdp_owner_purge_test_data('PURGE TEST DATA')`)).rejects.toThrow(/Owner only/)
    await as(ADMIN)
    await expect(db.query(`select public.dpdp_owner_purge_test_data()`)).rejects.toThrow(/PURGE TEST DATA/)
    await expect(db.query(`select public.dpdp_owner_purge_test_data('yes')`)).rejects.toThrow(/PURGE TEST DATA/)
    const out = await one<J>(`select public.dpdp_owner_purge_test_data('PURGE TEST DATA') as r`)
    expect(out).toMatchObject({ ok: true, remainingOrganisations: 0 })
    expect(out.organisationsDeleted).toBeGreaterThanOrEqual(1)
    for (const table of ['organisation', 'account', 'payment', 'membership', 'subscription']) {
      const col = table === 'organisation' ? 'id' : 'org_id'
      expect((await rows(`select 1 from dpdp.${table} where ${col} = $1`, [t.orgId])).length, table).toBe(0)
    }
    expect((await rows(`select 1 from dpdp.test_org where org_id = $1`, [t.orgId])).length).toBe(0)
    expect((await rows(`select 1 from dpdp.organisation where id = $1`, [real.orgId])).length).toBe(1)
    expect((await account(real.orgId))).toBeDefined()
    expect((await rows(`select 1 from dpdp.event where org_id = $1`, [t.orgId])).length).toBe(eventsBefore) // the older audit log is never touched
    const rec = await rows<J>(`select detail from dpdp.audit_platform_event where kind = 'test_data_purged' order by id desc limit 1`)
    expect(rec[0].detail.organisations).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(rec)).not.toMatch(/@/)
    expect((await rows(`select 1 from dpdp.visit_session where is_test`)).length).toBe(0)
  })
})

describe('the offer end date', () => {
  test('it is null for every plan, never in any output, and a NULL end with a start date still means the offer is on', async () => {
    expect((await rows(`select 1 from dpdp.plan where offer_ends_on is not null`)).length).toBe(0)
    const plans = await one<J[]>(`select public.dpdp_public_plans() as r`)
    const json = JSON.stringify(plans)
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(json).not.toMatch(/offerEndsOn|offer_ends/i)
    expect(plans.find((p) => p.key === 'institution')).toMatchObject({ monthlyPaise: 39900, offerLabel: 'Festive offer: 50% off' })
    const { email, orgId } = await openAccount('institution')
    await as(email)
    expect(JSON.stringify(await one<J>(`select public.dpdp_my_account() as r`))).not.toMatch(/\d{4}-\d{2}-\d{2}.*offer|offerEnds/i)
    expect((await account(orgId)).locked_monthly_paise).toBe(39900)
  })

  test('only the owner sets it; the value lives only in dpdp.plan; the answer and the audit row never contain it', async () => {
    const { email } = await openAccount('institution')
    for (const who of [email, '']) {
      await as(who)
      await expect(db.query(`select public.dpdp_owner_set_offer_end(date '2027-03-31')`)).rejects.toThrow(/Owner only/)
    }
    await as(ADMIN)
    const r = await one<J>(`select public.dpdp_owner_set_offer_end(date '2027-03-31') as r`)
    expect(JSON.stringify(r)).not.toContain('2027')
    expect((await rows<J>(`select distinct offer_ends_on::text as d from dpdp.plan`))[0].d).toBe('2027-03-31')
    const audit = await rows<J>(`select detail from dpdp.audit_platform_event where kind = 'offer_end_changed' order by id desc limit 1`)
    expect(JSON.stringify(audit)).not.toContain('2027')
    expect(JSON.stringify(await one<J[]>(`select public.dpdp_public_plans() as r`))).not.toContain('2027')
    await expect(db.query(`select public.dpdp_owner_set_offer_end(date '2020-01-01')`)).rejects.toThrow(/before the offer starts/)
    await db.query(`select public.dpdp_owner_set_offer_end(null)`)
    expect((await rows(`select 1 from dpdp.plan where offer_ends_on is not null`)).length).toBe(0)
  })

  test('no migration, page, e-mail or doc this change touches states an end date', async () => {
    const sql = read('drizzle/0735_dpdp_test_live_mode_profile_capture.sql')
    expect(sql).not.toMatch(/offer_ends_on\s*=\s*date '|2026-12-31/)
  })
})

describe('the optional profile: empty is fine, bad values are ignored, never refused', () => {
  test('an account with no details at all still works end to end and shows a calm progress figure', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    await db.query(`select public.t_work()`)
    const acct = await one<J>(`select public.dpdp_my_account() as r`)
    expect(acct.profile).toMatchObject({ done: 0, total: 8, percent: 0 })
    expect(acct.profile.missing.length).toBe(8)
    expect((await rows(`select 1 from dpdp.account_profile where org_id = $1`, [orgId])).length).toBe(0)
  })

  test('firm details are saved and counted; a wrong GSTIN, phone or number of clients is ignored and named, the rest is kept', async () => {
    const { email, orgId } = await openAccount('firm')
    await as(email)
    const r = await one<J>(`select public.dpdp_account_save_profile($1::jsonb) as r`, [JSON.stringify({
      firmName: 'Sharma & Co', city: 'Pune', gstin: '27ABCDE1234F1Z5', clientsEstimate: '42', contactPerson: 'A Sharma', phone: '+91 98765 43210', professionalBody: 'ICAI', registrationNo: '123456',
    })])
    expect(r.ignored).toEqual([])
    expect(r.profile).toMatchObject({ done: 8, total: 8, percent: 100 })
    expect(r.profile.fields).toMatchObject({ firmName: 'Sharma & Co', city: 'Pune', gstin: '27ABCDE1234F1Z5', clientsEstimate: 42 })
    const bad = await one<J>(`select public.dpdp_account_save_profile($1::jsonb) as r`, [JSON.stringify({ gstin: 'nope', phone: 'call me', clientsEstimate: 'lots', city: 'Mumbai' })])
    expect(bad.ignored.sort()).toEqual(['clientsEstimate', 'gstin', 'phone'])
    expect(bad.profile.fields.city).toBe('Mumbai')
    expect((await rows<J>(`select gstin, phone, clients_estimate from dpdp.account_profile where org_id = $1`, [orgId]))[0]).toEqual({ gstin: null, phone: null, clients_estimate: null })
    // an empty string clears a field
    await db.query(`select public.dpdp_account_save_profile('{"city": ""}'::jsonb)`)
    expect((await rows<J>(`select city from dpdp.account_profile where org_id = $1`, [orgId]))[0].city).toBeNull()
    // nothing of it reaches the audit trail
    const ev = await rows<J>(`select summary, detail from dpdp.event where org_id = $1 and kind = 'account_profile_saved'`, [orgId])
    expect(ev.length).toBeGreaterThan(0)
    expect(JSON.stringify(ev)).not.toMatch(/Sharma|27ABCDE|Pune|@/)
  })

  test('institution details, including the DPO / Grievance Officer, with the same rules; the owner of the account only', async () => {
    const { email } = await openAccount('institution')
    await as(email)
    const r = await one<J>(`select public.dpdp_account_save_profile($1::jsonb) as r`, [JSON.stringify({
      legalName: 'Bright School Trust', institutionType: 'ngo', sizeBand: '51-200', city: 'Delhi', contactPerson: 'P Rao', phone: '011-2345678', dpoName: 'S Iyer', dpoEmail: 'Dpo@Bright.example',
    })])
    expect(r.ignored).toEqual([])
    expect(r.profile.fields).toMatchObject({ institutionType: 'NGO', sizeBand: '51-200', dpoEmail: 'dpo@bright.example' })
    expect(r.profile.total).toBe(9)
    const bad = await one<J>(`select public.dpdp_account_save_profile($1::jsonb) as r`, [JSON.stringify({ institutionType: 'cult', sizeBand: 'huge', dpoEmail: 'nope' })])
    expect(bad.ignored.sort()).toEqual(['dpoEmail', 'institutionType', 'sizeBand'])
    await as('')
    await expect(db.query(`select public.dpdp_account_save_profile('{}'::jsonb)`)).rejects.toThrow(/Not a member/)
  })
})
