/// <reference types="bun-types" />
// DPDP ICP weekly lifecycle, slice 2 (drizzle/0762): PROVE. Evidence (append-only), breach clocks, requests and grievances (90-day ceiling), erasure, the pack and
// the History-chain check, the seven checklist steps. Offline proof on PGlite (real Postgres as WASM); the live database is never touched.
// 0761 (the register, the weekly record, the helpers 0762 builds on) and the real breach migration 0726 are executed first, then the WHOLE of 0762 twice.
// Run: bun test --isolate src/lib/services/dpdp-icp-prove.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, fnFrom, read } from './dpdp-pglite-base'

const F0761 = 'drizzle/0761_dpdp_icp_identify_classify.sql'
const F0762 = 'drizzle/0762_dpdp_icp_prove.sql'
const DOWN = 'drizzle/down/0762_dpdp_icp_prove.down.sql'
const HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

let db: PGlite
type J = Record<string, any>
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.role', '', false)`, [JSON.stringify(email ? { email } : {})])
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const fails = async (sql: string, params: unknown[] = []) => { try { await db.query(sql, params); return null } catch (e) { return (e as Error).message } }
const rpc = (fn: string, ...args: unknown[]) => one<J>(`select public.${fn}(${args.map((_, i) => (typeof args[i] === 'object' && args[i] !== null ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')}) as r`, args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : a)))
const rpcFails = (fn: string, ...args: unknown[]) => fails(`select public.${fn}(${args.map((_, i) => (typeof args[i] === 'object' && args[i] !== null ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})`, args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : a)))
const status = (orgId: string) => one<J>(`select public.dpdp_icp_status($1) as r`, [orgId])
const step = async (orgId: string, key: string) => (await status(orgId)).prove.steps.find((s: J) => s.key === key) as J

async function person(key: string) {
  const email = `${key}@prove.test`
  await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2) on conflict do nothing`, [`i_${key}`, email])
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true) on conflict do nothing`, [`ie_${key}`, `i_${key}`, email])
}
async function org(key: string, ownerKey: string) {
  await db.query(`insert into dpdp.organisation (id, name, slug, product) values ($1, $2, $1, 'institution')`, [key, `Org ${key}`])
  await person(ownerKey)
  await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ($1, $2, $3, 'owner', 'created')`, [`m_${key}`, `i_${ownerKey}`, key])
}
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString().slice(0, 19)
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  await db.exec(`
    alter table dpdp.obligation_template add column key text, add column part integer, add column data_set text, add column role_tag text;
    alter table dpdp.obligation add column assigned_person_id text;
    create type dpdp.holder_kind as enum ('internal_person', 'processor_org');
    create type dpdp.location_state as enum ('unknown', 'asked', 'confirmed', 'blocked_no_agreement');
    create table dpdp.data_category (id text primary key, org_id text not null, category text not null, subject_group text, is_children_data boolean not null default false);
    create table dpdp.data_location (id text primary key, category_id text not null, system_name text, path_text text, physical_location text, holder_kind dpdp.holder_kind not null,
      holder_person_id text, holder_org_id text, state dpdp.location_state not null default 'unknown', confirmed_by text, confirmed_at timestamp, asked_at timestamp);
    create table dpdp.consent_campaign (id text primary key, org_id text not null, principal_is_child boolean not null default false);
    create table dpdp.consent_token (id text primary key, campaign_id text not null, acted_at timestamp);
    create table dpdp.consent_record (id text primary key, token_id text not null, purpose_key text not null, granted boolean not null, withdrawn_at timestamp, recorded_at timestamp not null default now());
    create table dpdp.notice_version (id text primary key, org_id text not null, doc_kind text, version integer, released_on date, effective_from date, effective_to date, languages text[], state text);
    create table dpdp.rights_request (id text primary key, org_id text not null, ref text not null unique, kind text not null, arrived_via text not null, received_at timestamp not null default now(),
      due_at timestamp not null, state text not null default 'open', answered_at timestamp, answer_text text);
    alter table dpdp.breach add column scope_person_count integer, add column board_notified_at timestamp, add column individuals_notified_at timestamp;
    alter table dpdp.grievance add column tier smallint not null default 1, add column officer_due_at timestamp not null default now();
    ${fnFrom('drizzle/0607_dpdp_wo012_ai_link.sql', 'dpdp__viewer_kind')}
  `)
  await db.exec(read('drizzle/0726_dpdp_breach_rule7_fields.sql'))
  await db.exec(read(F0761))
  await db.exec(read(F0762))
  await db.exec(read(F0762)) // re-runnable
  await org('school', 'owner')
  await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_school_clerk', 'i_clerk', 'school', 'staff', 'created')`).catch(async () => {
    await person('clerk')
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_school_clerk', 'i_clerk', 'school', 'staff', 'created')`)
  })
  await person('outsider')
}, 120_000)

describe('the migration file', () => {
  test('both new tables have row level security on and no direct grant to a browser role; every function is closed to anon', async () => {
    const t = await rows<J>(`select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname in ('icp_evidence', 'icp_erasure') order by 1`)
    expect(t).toEqual([{ relname: 'icp_erasure', rls: true }, { relname: 'icp_evidence', rls: true }])
    expect((await rows<J>(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'dpdp' and table_name in ('icp_evidence', 'icp_erasure') and grantee in ('anon', 'authenticated', 'PUBLIC')`))[0].n).toBe(0)
    const open = await rows<J>(`select routine_name from information_schema.routine_privileges where routine_schema = 'public' and routine_name like 'dpdp\\_icp\\_%' and grantee in ('anon', 'PUBLIC')`)
    expect(open).toEqual([])
  })
  test('a person outside the organisation learns nothing; staff cannot read or write; signed out gets "not found"', async () => {
    await as('outsider@prove.test')
    expect(await rpcFails('dpdp_icp_prove_overview', 'school')).toContain('Organisation not found')
    await as('clerk@prove.test')
    for (const fn of ['dpdp_icp_prove_overview', 'dpdp_icp_evidence_pack']) expect(await rpcFails(fn, 'school')).toContain('Only the people who see the whole organisation')
    expect(await rpcFails('dpdp_icp_breach_log', 'school', { description: 'A laptop was lost' })).toContain('Only the people who see the whole organisation')
    await as('')
    expect(await rpcFails('dpdp_icp_prove_overview', 'school')).toContain('Organisation not found')
  })
})

describe('PROVE: evidence is append-only', () => {
  test('a record needs a title and a fingerprint or a place; no contact details; the fingerprint is 64 hex; the date must be sensible', async () => {
    await as('owner@prove.test')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'policy', title: 'x' })).toContain('short title')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'policy', title: 'Privacy policy' })).toContain('fingerprint')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'policy', title: 'Policy', reference: 'ask asha@example.com' })).toContain('e-mail address or phone')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'policy', title: 'Policy', sha256: 'xyz' })).toContain('64 letters')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'nope', title: 'Policy', sha256: HASH })).toContain('Pick what kind')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'policy', title: 'Policy', sha256: HASH, evidenceOn: '2099-01-01' })).toContain('looks wrong')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'agreement', title: 'Agreement', sha256: HASH, itemId: 'nope' })).toContain('not found')
  })
  test('adding ticks "evidence this week"; a stored row can be neither edited nor deleted; withdrawing works once; History never carries the title', async () => {
    await as('owner@prove.test')
    expect((await step('school', 'evidence_this_week')).done).toBe(false)
    const r = await rpc('dpdp_icp_evidence_add', 'school', { kind: 'policy', title: 'Privacy policy v3', sha256: HASH, filename: 'policy.pdf', sizeBytes: 1234, evidenceOn: day(-2) })
    expect(r.ok).toBe(true)
    expect((await step('school', 'evidence_this_week')).done).toBe(true)
    expect(await fails(`update dpdp.icp_evidence set title = 'Changed' where org_id = 'school'`)).toContain('withdraw it instead')
    expect(await fails(`delete from dpdp.icp_evidence where org_id = 'school'`)).toContain('withdraw it instead')
    expect(await rpcFails('dpdp_icp_evidence_withdraw', 'school', r.id, 'x')).toContain('3 to 200')
    expect((await rpc('dpdp_icp_evidence_withdraw', 'school', r.id, 'Wrong file attached')).ok).toBe(true)
    expect(await rpcFails('dpdp_icp_evidence_withdraw', 'school', r.id, 'Again please')).toContain('already withdrawn')
    expect((await step('school', 'evidence_this_week')).done).toBe(false)
    expect(await fails(`update dpdp.icp_evidence set title = 'Changed' where org_id = 'school'`)).toContain('withdraw it instead')
    const ev = await rows<J>(`select summary, detail from dpdp.event where org_id = 'school'`)
    for (const e of ev) expect(`${e.summary} ${e.detail ?? ''}`).not.toMatch(/Privacy|policy/i)
  })
  test('"nothing to attach this week" (a person\'s skipped Prove sign-off) ticks the step too; the label is the role, never an e-mail address', async () => {
    await as('owner@prove.test')
    await rpc('dpdp_icp_log', 'school', 'prove', 'skipped', 'Nothing to attach this week')
    expect((await step('school', 'evidence_this_week')).done).toBe(true)
    const ev = await rows<J>(`select actor_label from dpdp.icp_evidence where org_id = 'school'`)
    expect(ev.every((e) => e.actor_label === 'Owner')).toBe(true)
  })
})

describe('PROVE: outside helpers and their signed agreements', () => {
  test('a helper marked "signed" with no record attached keeps the step red; attaching the record turns it green', async () => {
    await as('owner@prove.test')
    const v = (await rpc('dpdp_icp_save_item', 'school', { kind: 'vendor', name: 'Acme Software', agreementStatus: 'signed' })).item
    expect((await step('school', 'agreements_on_record')).done).toBe(false)
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'agreement', title: 'Other org line', sha256: HASH, itemId: 'zzz' })).toContain('not found')
    await rpc('dpdp_icp_evidence_add', 'school', { kind: 'agreement', title: 'Acme agreement', sha256: HASH, itemId: v.id, evidenceOn: day(-10) })
    expect((await step('school', 'agreements_on_record')).done).toBe(true)
    const o = await rpc('dpdp_icp_prove_overview', 'school')
    expect(o.vendors.find((x: J) => x.name === 'Acme Software')).toMatchObject({ agreementStatus: 'signed', hasEvidence: true })
  })
})

describe('PROVE: breach clocks', () => {
  test('a breach starts a 72-hour and a 6-hour clock; the step is red only when the detailed report is late; a timestamp is set once; closed is closed', async () => {
    await as('owner@prove.test')
    expect(await rpcFails('dpdp_icp_breach_log', 'school', { description: 'no' })).toContain('few')
    expect(await rpcFails('dpdp_icp_breach_log', 'school', { description: 'Pen drive lost, ask asha@example.com' })).toContain('e-mail address or phone')
    expect(await rpcFails('dpdp_icp_breach_log', 'school', { description: 'A laptop was lost', becameAwareAt: '2020-01-01T00:00:00Z' })).toContain('looks wrong')
    const aware = iso(-5 * 86_400_000)
    const r = await rpc('dpdp_icp_breach_log', 'school', { description: 'A staff laptop with marks was lost', becameAwareAt: `${aware}Z`, peopleAffected: 40 })
    expect(r.ok).toBe(true)
    const b = (await rows<J>(`select deadline_at, cert_in_due_at, scope_person_count from dpdp.breach where id = $1`, [r.id]))[0]
    expect(new Date(b.deadline_at).getTime() - new Date(`${aware}Z`).getTime()).toBe(72 * 3_600_000)
    expect(new Date(b.cert_in_due_at).getTime() - new Date(`${aware}Z`).getTime()).toBe(6 * 3_600_000)
    expect(b.scope_person_count).toBe(40)
    expect((await step('school', 'breach_clocks')).done).toBe(false) // 5 days ago + 72h is long past
    await rpc('dpdp_icp_breach_update', 'school', r.id, { boardNotified: true })
    expect((await step('school', 'breach_clocks')).done).toBe(false) // the first intimation is not the detailed report
    await rpc('dpdp_icp_breach_update', 'school', r.id, { boardDetailed: true })
    expect((await step('school', 'breach_clocks')).done).toBe(true)
    const first = (await rows<J>(`select board_notified_at from dpdp.breach where id = $1`, [r.id]))[0].board_notified_at
    await rpc('dpdp_icp_breach_update', 'school', r.id, { boardNotified: true })
    expect((await rows<J>(`select board_notified_at from dpdp.breach where id = $1`, [r.id]))[0].board_notified_at).toEqual(first)
    expect(await rpcFails('dpdp_icp_breach_update', 'school', r.id, { certInReference: 'ref asha@example.com' })).toContain('Leave out')
    await rpc('dpdp_icp_breach_update', 'school', r.id, { closed: true })
    expect(await rpcFails('dpdp_icp_breach_update', 'school', r.id, { individualsNotified: true })).toContain('closed')
  })
  test('a breach inside its 72 hours does not turn the step red', async () => {
    await as('owner@prove.test')
    await rpc('dpdp_icp_breach_log', 'school', { description: 'A printed list was left in a taxi', becameAwareAt: `${iso(-3_600_000)}Z` })
    expect((await step('school', 'breach_clocks')).done).toBe(true)
  })
})

describe('PROVE: requests and grievances', () => {
  test('a request is due 90 days after it arrived; past due only after that day; a grievance needs a short summary, a plain request keeps none', async () => {
    await as('owner@prove.test')
    expect(await rpcFails('dpdp_icp_request_log', 'school', { type: 'grievance', receivedOn: day(-1) })).toContain('Say in a few words')
    expect(await rpcFails('dpdp_icp_request_log', 'school', { type: 'grievance', receivedOn: day(-1), summary: 'Asha 98765 43210 wrote' })).toContain('Leave out')
    expect(await rpcFails('dpdp_icp_request_log', 'school', { type: 'access', receivedOn: '2099-01-01' })).toContain('looks wrong')
    expect(await rpcFails('dpdp_icp_request_log', 'school', { type: 'access', arrivedVia: 'carrier pigeon', receivedOn: day(-1) })).toContain('Pick how')
    const ok = await rpc('dpdp_icp_request_log', 'school', { type: 'access', arrivedVia: 'email', receivedOn: day(-89) })
    expect(ok.ref).toMatch(/^RR-/)
    expect(ok.dueOn).toBe(day(1))
    expect((await step('school', 'requests_on_time')).done).toBe(true) // the 90th day is tomorrow
    const late = await rpc('dpdp_icp_request_log', 'school', { type: 'correction', arrivedVia: 'post', receivedOn: day(-91) })
    expect((await step('school', 'requests_on_time')).done).toBe(false)
    expect(await rpcFails('dpdp_icp_request_close', 'school', late.ref, 'nonsense')).toContain('Pick how')
    await rpc('dpdp_icp_request_close', 'school', late.ref, 'corrected')
    expect(await rpcFails('dpdp_icp_request_close', 'school', late.ref, 'corrected')).toContain('already answered')
    expect((await step('school', 'requests_on_time')).done).toBe(true)
    const g = await rpc('dpdp_icp_request_log', 'school', { type: 'grievance', receivedOn: day(-3), summary: 'Fee receipt not received' })
    expect(g.ref).toMatch(/^GR-/)
    expect((await rows<J>(`select received_at is not null as r from dpdp.grievance where ref = $1`, [g.ref]))[0].r).toBe(true)
    const pack = await rpc('dpdp_icp_evidence_pack', 'school')
    expect(JSON.stringify(pack.requests)).not.toContain('Fee receipt')
    expect((await rows<J>(`select answer_text from dpdp.rights_request`)).every((r) => r.answer_text === null || ['provided', 'corrected', 'erased', 'refused_with_reason', 'withdrawn', 'answered'].includes(r.answer_text))).toBe(true)
  })
})

describe('PROVE: erasure', () => {
  test('an erasure has a due date; late until closed; "not needed" needs a reason; never a person as the scope; closes once', async () => {
    await as('owner@prove.test')
    expect(await rpcFails('dpdp_icp_erasure_log', 'school', { scope: 'asha@example.com' })).toContain('not a person')
    expect(await rpcFails('dpdp_icp_erasure_log', 'school', { scope: 'Old forms', trigger: 'whim' })).toContain('Pick why this erasure')
    const e = await rpc('dpdp_icp_erasure_log', 'school', { scope: 'Admission forms of 2019', trigger: 'retention_ended', dueOn: day(-5) })
    expect((await step('school', 'erasures_on_time')).done).toBe(false)
    expect(await rpcFails('dpdp_icp_erasure_close', 'school', e.id, { state: 'not_needed' })).toContain('Say why')
    await rpc('dpdp_icp_erasure_close', 'school', e.id, { state: 'done', method: 'Shredded' })
    expect((await step('school', 'erasures_on_time')).done).toBe(true)
    expect(await rpcFails('dpdp_icp_erasure_close', 'school', e.id, { state: 'done' })).toContain('already')
  })
})

describe('PROVE: the pack, the chain check and the checklist', () => {
  test('the pack lists what was recorded but leaves out a breach description and carries the honest limits; the History chain is intact', async () => {
    await as('owner@prove.test')
    const pack = await rpc('dpdp_icp_evidence_pack', 'school')
    expect(JSON.stringify(pack.breaches)).not.toContain('laptop')
    expect(JSON.stringify(pack)).not.toMatch(/@|98765/)
    expect(pack.what).toContain('not a certificate')
    expect(pack.limits).toHaveLength(4)
    expect(pack.history.intact).toBe(true)
    expect(pack.history.linksBroken).toBe(0)
    expect(pack.history.hashesWrong).toBe(0)
    expect(pack.history.events).toBeGreaterThan(8)
  })
  test('the chain check notices a tampered link and a tampered hash', async () => {
    const ev = await rows<J>(`select id, hash, prev_hash from dpdp.event where org_id = 'school' order by occurred_at, id`)
    const mid = ev[Math.floor(ev.length / 2)]
    await db.query(`alter table dpdp.event disable trigger user`)
    await db.query(`update dpdp.event set hash = repeat('0', 64) where id = $1`, [mid.id])
    const bad = (await rows<J>(`select dpdp.icp_chain_check('school') as r`))[0].r as J
    expect(bad.intact).toBe(false)
    expect(bad.hashesWrong).toBeGreaterThan(0)
    await db.query(`update dpdp.event set hash = $2 where id = $1`, [mid.id, mid.hash])
    await db.query(`alter table dpdp.event enable trigger user`)
    expect(((await rows<J>(`select dpdp.icp_chain_check('school') as r`))[0].r as J).intact).toBe(true)
  })
  test('the Prove checklist has seven steps; "the week is signed off" is a person\'s plain sign-off; counts add up', async () => {
    await as('owner@prove.test')
    let s = await status('school')
    expect(s.prove.total).toBe(7)
    expect(s.prove.steps.map((x: J) => x.key)).toEqual(['jobs_not_late', 'evidence_this_week', 'agreements_on_record', 'breach_clocks', 'requests_on_time', 'erasures_on_time', 'week_signed_off'])
    expect((await step('school', 'week_signed_off')).done).toBe(false)
    await rpc('dpdp_icp_log', 'school', 'prove', 'ok', null)
    expect((await step('school', 'week_signed_off')).done).toBe(true)
    s = await status('school')
    expect(s.total).toBe(s.identify.total + s.classify.total + s.prove.total)
  })
  test('a job that is "submitted" is not late; an open job past its date is', async () => {
    await as('owner@prove.test')
    await db.query(`insert into dpdp.obligation_template (id, name) values ('tj', 'A job')`)
    await db.query(`insert into dpdp.obligation (id, org_id, template_id, state, due_on) values ('oj1', 'school', 'tj', 'submitted', current_date - 10)`)
    expect((await step('school', 'jobs_not_late')).done).toBe(true)
    await db.query(`insert into dpdp.obligation (id, org_id, template_id, state, due_on) values ('oj2', 'school', 'tj', 'open', current_date - 10)`)
    expect((await step('school', 'jobs_not_late')).done).toBe(false)
  })
})

describe('PROVE: what the Audit 2 found (kept as regression tests)', () => {
  test('a grievance made before this screen (G-0001 style, no received date, free-text decision) can be answered here; its received date is never invented; free text never reaches the pack', async () => {
    await as('')
    await db.query(`insert into dpdp.grievance (id, org_id, ref, summary, state, officer_decision, tier, officer_due_at) values ('lg1', 'school', 'G-0001', 'Old complaint', 'open', 'We told Rahul Mehta (rahul@x.com) about it', 1, $1)`, [`${day(-2)}T00:00:00`])
    await db.query(`insert into dpdp.rights_request (id, org_id, ref, kind, arrived_via, received_at, due_at, state, answered_at, answer_text) values ('lr1', 'school', 'R-0001', 'access', 'email', $1, $2, 'answered', now(), 'Dear Asha Verma, mail asha.verma@gmail.com or 98765 43210')`, [`${day(-20)}T00:00:00`, `${day(70)}T00:00:00`])
    await as('owner@prove.test')
    const o = await rpc('dpdp_icp_prove_overview', 'school')
    const g = o.requests.find((x: J) => x.ref === 'G-0001')
    expect(g.receivedOn).toBeNull() // not worked backwards from the due date
    expect(g.pastDue).toBe(true)
    expect((await step('school', 'requests_on_time')).done).toBe(false)
    const pack = JSON.stringify(await rpc('dpdp_icp_evidence_pack', 'school'))
    expect(pack).not.toMatch(/@|98765|Rahul|Asha/)
    expect(o.requests.find((x: J) => x.ref === 'R-0001').outcome).toBe('answered')
    await rpc('dpdp_icp_request_close', 'school', 'G-0001', 'answered') // the prefix is not a guide: it is found where it lives
    expect((await step('school', 'requests_on_time')).done).toBe(true)
    expect((await rows<J>(`select officer_decision from dpdp.grievance where ref = 'G-0001'`))[0].officer_decision).toContain('Rahul') // a decision already written is never overwritten
    expect(JSON.stringify(await rpc('dpdp_icp_evidence_pack', 'school'))).not.toContain('Rahul')
  })
  test('a request row from an older, unvalidated flow cannot carry free text through its kind or how it arrived; a breach an older flow marked "notified" is still a live breach', async () => {
    await as('')
    await db.query(`insert into dpdp.rights_request (id, org_id, ref, kind, arrived_via, received_at, due_at, state) values ('lr2', 'school', 'R-0002', 'Asha Rao (asha@gmail.com, 9876543210) wants her marks deleted', 'call me on 9876543210', now(), now() + interval '30 days', 'open')`)
    await as('owner@prove.test')
    const o = await rpc('dpdp_icp_prove_overview', 'school')
    const r = o.requests.find((x: J) => x.ref === 'R-0002')
    expect(r.type).toBe('other')
    expect(r.arrivedVia).toBe('other')
    expect(JSON.stringify(await rpc('dpdp_icp_evidence_pack', 'school'))).not.toMatch(/Asha Rao|9876543210|asha@gmail/)
    await as('')
    await db.query(`update dpdp.rights_request set answered_at = now(), state = 'answered' where ref = 'R-0002'`)
    await db.query(`insert into dpdp.breach (id, org_id, became_aware_at, deadline_at, state, description) values ('nb1', 'school', now() - interval '5 days', now() - interval '2 days', 'notified', 'Old flow breach')`)
    await as('owner@prove.test')
    expect((await step('school', 'breach_clocks')).done).toBe(false) // not hidden by its state word
    expect((await rpc('dpdp_icp_prove_overview', 'school')).breaches.find((b: J) => b.id === 'nb1').pastClock).toBe(true)
    await rpc('dpdp_icp_breach_update', 'school', 'nb1', { boardDetailed: true }) // updating it really changes it
    expect((await rows<J>(`select board_detailed_at is not null as d from dpdp.breach where id = 'nb1'`))[0].d).toBe(true)
    await as('')
    await db.query(`update dpdp.breach set state = 'closed' where id = 'nb1'`)
    await as('owner@prove.test')
    expect(await rpcFails('dpdp_icp_breach_update', 'school', 'nb1', { boardNotified: true })).toContain('closed')
  })
  test('a breach cannot be closed until the detailed report to the Board is recorded, so closing never hides a late report', async () => {
    await as('owner@prove.test')
    const r = await rpc('dpdp_icp_breach_log', 'school', { description: 'A cupboard of old forms was left open', becameAwareAt: `${iso(-10 * 86_400_000)}Z` })
    expect((await step('school', 'breach_clocks')).done).toBe(false)
    expect(await rpcFails('dpdp_icp_breach_update', 'school', r.id, { closed: true })).toContain('detailed report')
    expect((await step('school', 'breach_clocks')).done).toBe(false)
    expect(await rpcFails('dpdp_icp_breach_update', 'school', r.id, {})).toContain('Say what to update')
    expect(await rpcFails('dpdp_icp_breach_update', 'school', r.id, { boardNotified: 'abc' })).toContain('Tick a box')
    await rpc('dpdp_icp_breach_update', 'school', r.id, { boardDetailed: true, closed: true }) // reporting and closing in one go is fine
    expect((await step('school', 'breach_clocks')).done).toBe(true)
    expect((await rows<J>(`select state from dpdp.breach where id = $1`, [r.id]))[0].state).toBe('closed')
  })
  test('a time with an offset is stored as the same instant in UTC, and a date later today (UTC+1) is accepted', async () => {
    await as('owner@prove.test')
    const t = new Date(Date.now() - 2 * 3_600_000)
    const ist = new Date(t.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 19) + '+05:30'
    const r = await rpc('dpdp_icp_breach_log', 'school', { description: 'A phone with a class list was lost', becameAwareAt: ist })
    const b = (await rows<J>(`select became_aware_at from dpdp.breach where id = $1`, [r.id]))[0]
    expect(Math.abs(new Date(`${new Date(b.became_aware_at).toISOString().slice(0, 19)}Z`).getTime() - t.getTime())).toBeLessThan(1500)
    const tomorrow = await rpc('dpdp_icp_request_log', 'school', { type: 'access', arrivedVia: 'phone', receivedOn: day(1) })
    expect(tomorrow.ok).toBe(true)
  })
  test('a retired register line takes no new record; an empty erasure close does nothing', async () => {
    await as('owner@prove.test')
    const v = (await rpc('dpdp_icp_save_item', 'school', { kind: 'vendor', name: 'Old Vendor', agreementStatus: 'requested' })).item
    await rpc('dpdp_icp_retire_item', 'school', v.id, 'No longer used')
    expect(await rpcFails('dpdp_icp_evidence_add', 'school', { kind: 'agreement', title: 'Late agreement', sha256: HASH, itemId: v.id })).toContain('not found')
    expect((await rows<J>(`select agreement_status from dpdp.icp_item where id = $1`, [v.id]))[0].agreement_status).not.toBe('signed')
    const e = await rpc('dpdp_icp_erasure_log', 'school', { scope: 'Scratch files', trigger: 'other', dueOn: day(5) })
    expect(await rpcFails('dpdp_icp_erasure_close', 'school', e.id, {})).toContain('Say whether')
    expect((await rows<J>(`select state from dpdp.icp_erasure where id = $1`, [e.id]))[0].state).toBe('open')
  })
  test("another organisation's ids are never found, in any of the writes", async () => {
    await org('other', 'owner2')
    await as('owner2@prove.test')
    const ev = await rpc('dpdp_icp_evidence_add', 'other', { kind: 'policy', title: 'Their policy', sha256: HASH })
    const br = await rpc('dpdp_icp_breach_log', 'other', { description: 'Their own breach, described plainly' })
    const rq = await rpc('dpdp_icp_request_log', 'other', { type: 'access', arrivedVia: 'email' })
    const er = await rpc('dpdp_icp_erasure_log', 'other', { scope: 'Their old files', trigger: 'other' })
    await as('owner@prove.test')
    expect(await rpcFails('dpdp_icp_evidence_withdraw', 'school', ev.id, 'not yours')).toContain('not found')
    expect(await rpcFails('dpdp_icp_breach_update', 'school', br.id, { boardNotified: true })).toContain('not found')
    expect(await rpcFails('dpdp_icp_request_close', 'school', rq.ref, 'answered')).toContain('not found')
    expect(await rpcFails('dpdp_icp_erasure_close', 'school', er.id, { state: 'done' })).toContain('not found')
    expect(JSON.stringify(await rpc('dpdp_icp_evidence_pack', 'school'))).not.toContain('Their policy')
  })
  test('a pack that is cut short says so, and the History check says when it did not walk the whole chain', async () => {
    await as('')
    await db.query(`insert into dpdp.icp_evidence (id, org_id, kind, title, reference, evidence_on, week_start, recorded_by, actor_label)
      select 'bulk' || g, 'school', 'other', 'Bulk ' || g, 'x', current_date, dpdp.icp_week(), 'i_owner', 'Owner' from generate_series(1, 230) g`)
    await as('owner@prove.test')
    const pack = await rpc('dpdp_icp_evidence_pack', 'school')
    expect(pack.evidence).toHaveLength(200)
    expect(pack.truncated).toBe(true)
    expect(pack.totals.evidence).toBeGreaterThan(230)
    expect(pack.history.truncated).toBe(false)
    expect((await one<J>(`select dpdp.icp_chain_check('school', 3) as r`)).truncated).toBe(true)
  })
  test('the four legal-duty writes (breach log/update, request log/close) stay open on a locked account (they set the allow flag before the gate)', () => {
    const src = read(F0762)
    for (const fn of ['dpdp_icp_breach_log', 'dpdp_icp_breach_update', 'dpdp_icp_request_log', 'dpdp_icp_request_close']) {
      const body = src.slice(src.indexOf(`function public.${fn}(`)).split('$$;')[0]
      expect(body).toContain("set_config('dpdp.allow_locked', 'on', true)")
      expect(body.indexOf('allow_locked')).toBeLessThan(body.indexOf('dpdp__icp_member'))
    }
  })
})

describe('PROVE: what the Audit 4 found (kept as regression tests)', () => {
  test('the notice rows in the pack show plain words only: a hostile doc kind, state or language is never passed through', async () => {
    await as('')
    await db.query(`insert into dpdp.notice_version (id, org_id, doc_kind, version, released_on, languages, state) values ('nv_ok', 'school', 'privacy_notice', 1, current_date, array['en', 'hi'], 'active')`)
    await db.query(`insert into dpdp.notice_version (id, org_id, doc_kind, version, released_on, languages, state) values ('nv_bad', 'school', 'zz.hostile@evil.com 9876543210', 2, current_date, array['en', 'zz.hostile@evil.com'], '9876543210 call me')`)
    await as('owner@prove.test')
    const pack = await rpc('dpdp_icp_evidence_pack', 'school')
    expect(JSON.stringify(pack)).not.toMatch(/hostile|evil\.com|9876543210|call me/)
    const good = pack.notices.find((n: J) => n.docKind === 'privacy_notice')
    expect(good.languages).toEqual(['en', 'hi'])
    expect(good.state).toBe('active')
    const bad = pack.notices.find((n: J) => n.docKind === 'other')
    expect(bad.languages).toEqual(['en'])
    expect(bad.state).toBe('other')
  })
  test('a breach time is stored in UTC whatever the session time zone is (the function sets its own zone)', async () => {
    await as('owner@prove.test')
    await db.query(`set timezone = 'Asia/Kolkata'`)
    try {
      const r = await rpc('dpdp_icp_breach_log', 'school', { description: 'A pen drive with a class list was lost', becameAwareAt: `${day(-3)}T10:00:00` })
      const d = await rpc('dpdp_icp_breach_log', 'school', { description: 'A register was left on a bus', becameAwareAt: day(-4) })
      const a = (await rows<J>(`select to_char(became_aware_at, 'YYYY-MM-DD"T"HH24:MI:SS') as t from dpdp.breach where id = $1`, [r.id]))[0]
      const b = (await rows<J>(`select to_char(became_aware_at, 'YYYY-MM-DD') as t from dpdp.breach where id = $1`, [d.id]))[0]
      expect(a.t).toBe(`${day(-3)}T10:00:00`)
      expect(b.t).toBe(day(-4))
    } finally {
      await db.query(`reset timezone`)
    }
  })
})

describe('offboarding and roll-back', () => {
  test('while an organisation is being offboarded (exporting) its evidence may be deleted with it; otherwise never', async () => {
    await db.exec(`create table if not exists dpdp.org_offboarding (org_id text primary key, state text not null)`)
    await as('')
    expect(await fails(`delete from dpdp.icp_evidence where org_id = 'school'`)).toContain('withdraw it instead')
    await db.query(`insert into dpdp.org_offboarding (org_id, state) values ('school', 'exporting')`)
    await db.query(`delete from dpdp.icp_evidence where org_id = 'school'`)
    expect(await rows(`select 1 from dpdp.icp_evidence where org_id = 'school'`)).toHaveLength(0)
    await db.query(`delete from dpdp.org_offboarding where org_id = 'school'`)
  })
  test('roll-back removes the tables and the functions and puts the 0761 placeholder back', async () => {
    await db.exec(read(DOWN))
    expect((await rows<J>(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname in ('icp_evidence', 'icp_erasure')`))[0].n).toBe(0)
    expect((await rows<J>(`select count(*)::int as n from pg_proc where proname in ('dpdp_icp_evidence_add', 'dpdp_icp_breach_log', 'dpdp_icp_evidence_pack', 'icp_chain_check', 'icp_prove_counts')`))[0].n).toBe(0)
    await as('owner@prove.test')
    expect((await status('school')).prove.total).toBe(3)
  })
})
