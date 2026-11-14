/// <reference types="bun-types" />
// DPDP ICP weekly lifecycle, slice 1 (drizzle/0761): the register (IDENTIFY), the classification and its derived flags (CLASSIFY), the weekly
// record and status, and the History-chain lock. Offline proof on PGlite (real Postgres as WASM); the live database is never touched.
// The WHOLE migration file is executed (twice, to prove it is re-runnable) on top of the shared stand-in base; the older functions it builds on
// (caller identity / membership, the viewer kind, the event writer) are copied out of their own migration files at run time.
// Run: bun test --isolate src/lib/services/dpdp-icp-identify-classify.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, fnFrom, read } from './dpdp-pglite-base'
import { itemFlags } from '../../../dpdp-app/src/lib/icp'

const F0761 = 'drizzle/0761_dpdp_icp_identify_classify.sql'
const DOWN = 'drizzle/down/0761_dpdp_icp_identify_classify.down.sql'

let db: PGlite
type J = Record<string, any>
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.role', '', false)`, [JSON.stringify(email ? { email } : {})])
const asService = () => db.query(`select set_config('request.jwt.claims', '{}', false), set_config('request.jwt.claim.role', 'service_role', false)`)
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const fails = async (sql: string, params: unknown[] = []) => { try { await db.query(sql, params); return null } catch (e) { return (e as Error).message } }

async function person(key: string) {
  const email = `${key}@icp.test`
  await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2) on conflict do nothing`, [`i_${key}`, email])
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true) on conflict do nothing`, [`ie_${key}`, `i_${key}`, email])
  return email
}
async function org(key: string, product = 'institution') {
  await db.query(`insert into dpdp.organisation (id, name, slug, product) values ($1, $2, $1, $3)`, [key, `Org ${key}`, product])
}
async function member(orgId: string, key: string, level: 'owner' | 'staff') {
  await person(key)
  await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ($1, $2, $3, $4, 'created')`, [`m_${orgId}_${key}`, `i_${key}`, orgId, level])
}
const save = (orgId: string, item: J) => one<J>(`select public.dpdp_icp_save_item($1, $2::jsonb) as r`, [orgId, JSON.stringify(item)])
const register = (orgId: string) => one<J[]>(`select public.dpdp_icp_register($1) as r`, [orgId])
const status = (orgId: string) => one<J>(`select public.dpdp_icp_status($1) as r`, [orgId])
const flagKeys = (it: J) => (it.flags as J[]).map((f) => f.key).sort()
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

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
    ${fnFrom('drizzle/0607_dpdp_wo012_ai_link.sql', 'dpdp__viewer_kind')}
  `)
  await db.exec(read(F0761))
  await db.exec(read(F0761)) // re-runnable
  await org('school', 'institution')
  await member('school', 'owner', 'owner')
  await member('school', 'clerk', 'staff')
  await person('outsider')
}, 120_000)

describe('the migration file', () => {
  test('runs twice without error, and both tables have row level security on with no direct grant to a browser role', async () => {
    const t = await rows<J>(`select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname in ('icp_item', 'icp_run') order by 1`)
    expect(t).toEqual([{ relname: 'icp_item', rls: true }, { relname: 'icp_run', rls: true }])
    const g = await rows<J>(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'dpdp' and table_name in ('icp_item', 'icp_run') and grantee in ('anon', 'authenticated', 'PUBLIC')`)
    expect(g[0].n).toBe(0)
  })
  test('the History writer now takes a per-organisation lock before it reads the previous hash', async () => {
    const src = (await rows<J>(`select prosrc from pg_proc where proname = 'dpdp__append_event'`))[0].prosrc as string
    expect(src.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(-1)
    expect(src.indexOf('pg_advisory_xact_lock')).toBeLessThan(src.indexOf('select e.hash'))
  })
})

describe('who may do what', () => {
  test('the owner can add; a staff member can neither read nor change (the register names where children\'s data sits); a stranger learns nothing', async () => {
    await as('owner@icp.test')
    const r = await save('school', { kind: 'data_set', name: 'Student admission files', whereHeld: 'Admission office cabinet and ERP' })
    expect(r.ok).toBe(true)
    await as('clerk@icp.test')
    expect(await fails(`select public.dpdp_icp_register('school')`)).toContain('Only the people who see the whole organisation')
    expect(await fails(`select public.dpdp_icp_status('school')`)).toContain('Only the people who see the whole organisation')
    expect(await fails(`select public.dpdp_icp_save_item('school', '{"kind":"data_set","name":"x y"}'::jsonb)`)).toContain('Only the people who see the whole organisation')
    await as('outsider@icp.test')
    expect(await fails(`select public.dpdp_icp_register('school')`)).toContain('Organisation not found')
    expect(await fails(`select public.dpdp_icp_save_item('school', '{"kind":"data_set","name":"x y"}'::jsonb)`)).toContain('Organisation not found')
    await as('')
    expect(await fails(`select public.dpdp_icp_register('school')`)).toContain('Organisation not found')
  })
})

describe('IDENTIFY: the register', () => {
  test('a name that looks like an e-mail address or a phone number is refused with a plain sentence (the register holds things, not people)', async () => {
    await as('owner@icp.test')
    expect(await fails(`select public.dpdp_icp_save_item('school', '{"kind":"data_set","name":"asha.rao@example.com"}'::jsonb)`)).toContain('not a person')
    expect(await fails(`select public.dpdp_icp_save_item('school', '{"kind":"system","name":"Call 9876543210"}'::jsonb)`)).toContain('not a person')
    const id = ((await register('school'))[0] as J).id
    expect(await fails(`select public.dpdp_icp_save_item('school', $1::jsonb)`, [JSON.stringify({ id, name: 'mail me@x.in' })])).toContain('not a person')
  })
  test('a duplicate (same kind, same name, any case) is refused, also by renaming; a different kind with the same name is fine', async () => {
    await as('owner@icp.test')
    expect(await fails(`select public.dpdp_icp_save_item('school', '{"kind":"data_set","name":"  student ADMISSION files "}'::jsonb)`)).toContain('already in your register')
    expect((await save('school', { kind: 'system', name: 'Student admission files' })).ok).toBe(true)
    const sys = (await register('school')).find((i) => i.kind === 'system')!
    await save('school', { kind: 'system', name: 'Other system' })
    expect(await fails(`select public.dpdp_icp_save_item('school', $1::jsonb)`, [JSON.stringify({ id: sys.id, name: 'other SYSTEM' })])).toContain('already in your register')
    await one(`select public.dpdp_icp_retire_item('school', $1, 'Test clean-up') as r`, [(await register('school')).find((i) => i.name === 'Other system')!.id])
  })
  test('every free-text answer is kept free of e-mail addresses and phone numbers, and a bad choice or number gets a plain sentence', async () => {
    await as('owner@icp.test')
    const ds = (await register('school')).find((i) => i.kind === 'data_set')!
    for (const field of ['whereHeld', 'holderLabel', 'purpose', 'retentionNote', 'recipients', 'agreementRef'])
      expect(await fails(`select public.dpdp_icp_save_item('school', $1::jsonb)`, [JSON.stringify({ id: ds.id, [field]: 'ask asha@example.com or 98765 43210' })]), field).toContain('e-mail address or phone number')
    expect(await fails(`select public.dpdp_icp_save_item('school', $1::jsonb)`, [JSON.stringify({ id: ds.id, lawfulBasis: 'whatever' })])).toContain('Pick one of the choices')
    expect(await fails(`select public.dpdp_icp_save_item('school', $1::jsonb)`, [JSON.stringify({ id: ds.id, retentionDays: 12.5 })])).toContain('whole number')
    expect(await fails(`select public.dpdp_icp_save_item('school', $1::jsonb)`, [JSON.stringify({ id: ds.id, agreementOn: 'not a date' })])).toContain('Check the date')
  })
  test('a data set is mirrored into the older category and location tables (so the AI link data-map and the CA list see it); retiring removes the mirror', async () => {
    await as('owner@icp.test')
    const ds = (await register('school')).find((i) => i.kind === 'data_set')!
    const c = await rows<J>(`select category, subject_group, is_children_data from dpdp.data_category where org_id = 'school'`)
    expect(c).toEqual([{ category: 'Student admission files', subject_group: 'other', is_children_data: false }])
    expect((await rows<J>(`select system_name, state from dpdp.data_location`))[0]).toEqual({ system_name: 'Admission office cabinet and ERP', state: 'unknown' })
    await save('school', { kind: 'data_set', name: 'Fee receipts', whereHeld: 'Fee app' })
    const fee = (await register('school')).find((i) => i.name === 'Fee receipts')!
    expect(await rows(`select 1 from dpdp.data_category where org_id = 'school'`)).toHaveLength(2)
    await one(`select public.dpdp_icp_retire_item('school', $1, 'Moved to the ERP') as r`, [fee.id])
    expect(await rows(`select 1 from dpdp.data_category where org_id = 'school'`)).toHaveLength(1)
    expect((await register('school')).some((i) => i.id === fee.id)).toBe(false)
    expect(await fails(`select public.dpdp_icp_retire_item('school', $1, '   ')`, [ds.id])).toContain('why it is no longer held')
    expect(await fails(`select public.dpdp_icp_retire_item('school', $1, 'moved, ask asha@example.com')`, [ds.id])).toContain('e-mail address')
  })
  test('retiring one line keeps the older category while another line still points at it; retiring clears the free text; re-saving never downgrades a confirmed location', async () => {
    await as('owner@icp.test')
    const a = await save('school', { kind: 'data_set', name: 'Library records', whereHeld: 'Library app', purpose: 'Lending', recipients: 'Library vendor' })
    await db.query(`update dpdp.data_location set state = 'confirmed', confirmed_at = now() where system_name = 'Library app'`)
    await save('school', { id: a.item.id, retentionNote: 'Keep two years' })
    expect((await rows<J>(`select state from dpdp.data_location where system_name = 'Library app'`))[0].state).toBe('confirmed')
    await one(`select public.dpdp_icp_retire_item('school', $1, 'Library closed') as r`, [a.item.id])
    const gone = (await rows<J>(`select where_held, purpose, recipients, retention_note, status from dpdp.icp_item where id = $1`, [a.item.id]))[0]
    expect(gone).toEqual({ where_held: null, purpose: null, recipients: null, retention_note: null, status: 'retired' })
  })
  test('confirming marks lines as still true this week and the mirrored location becomes confirmed', async () => {
    await as('owner@icp.test')
    const n = await one<J>(`select public.dpdp_icp_confirm_items('school') as r`)
    expect(n.confirmed).toBe(2)
    expect((await rows<J>(`select state from dpdp.data_location`))[0].state).toBe('confirmed')
  })
  test('the starter list reads the data sets the library jobs name (Part 2, not switched off) and is re-runnable', async () => {
    await org('school2', 'institution')
    await member('school2', 'owner2', 'owner')
    await db.query(`insert into dpdp.obligation_template (id, name, key, part, data_set) values ('t1', 'a', 'institution-04', 2, 'Students'), ('t2', 'b', 'institution-05', 2, 'Staff records'), ('t3', 'c', 'institution-13', 3, 'Not part two'), ('t4', 'd', 'institution-06', 2, 'Parents')`)
    await db.query(`insert into dpdp.obligation (id, org_id, template_id, state, due_on) values ('o1','school2','t1','open', current_date), ('o2','school2','t2','open', current_date), ('o3','school2','t3','open', current_date), ('o4','school2','t4','not_applicable', current_date)`)
    await as('owner2@icp.test')
    expect((await one<J>(`select public.dpdp_icp_starter('school2') as r`)).added).toBe(2)
    expect((await one<J>(`select public.dpdp_icp_starter('school2') as r`)).added).toBe(0)
    const names = (await register('school2')).map((i) => i.name).sort()
    expect(names).toEqual(['Staff records', 'Students'])
    expect((await register('school2')).every((i) => flagKeys(i).includes('unclassified') && i.source === 'starter')).toBe(true)
  })
})

describe('CLASSIFY: facts, derived flags and the job rule', () => {
  test('a fully classified, confirmed line has no flags; taking a fact away brings "unclassified" back', async () => {
    await as('owner@icp.test')
    const ds = (await register('school')).find((i) => i.kind === 'data_set')!
    await save('school', { id: ds.id, principalType: 'staff', children: false, purpose: 'Run payroll', lawfulBasis: 'employment', retentionDays: 2555, sensitivity: 'elevated', recipients: 'Bank' })
    let it = (await register('school')).find((i) => i.id === ds.id)!
    expect(flagKeys(it)).toEqual([])
    expect((await rows<J>(`select classified_at is not null as c from dpdp.icp_item where id = $1`, [ds.id]))[0].c).toBe(true)
    await save('school', { id: ds.id, purpose: null })
    it = (await register('school')).find((i) => i.id === ds.id)!
    expect(flagKeys(it)).toEqual(['unclassified'])
    expect((await rows<J>(`select classified_at is null as c from dpdp.icp_item where id = $1`, [ds.id]))[0].c).toBe(true)
  })
  test("children's data: no basis -> flagged; consent with no parent answer -> flagged; ONE unanswered link keeps it flagged; a school exemption raises no flag; any other basis asks for a check", async () => {
    await as('owner@icp.test')
    await save('school', { kind: 'data_set', name: 'Student records', whereHeld: 'ERP', principalType: 'student', children: true, purpose: 'Teaching', retentionDays: 3650 })
    const get = async () => (await register('school')).find((i) => i.name === 'Student records')!
    let it = await get()
    expect(flagKeys(it)).toEqual(['children_basis_missing', 'unclassified'])
    await save('school', { id: it.id, lawfulBasis: 'consent' })
    expect(flagKeys(await get())).toEqual(['children_consent_not_collected'])
    await db.query(`insert into dpdp.consent_campaign (id, org_id, principal_is_child) values ('c1', 'school', true)`)
    await db.query(`insert into dpdp.consent_token (id, campaign_id, acted_at) values ('t1', 'c1', null), ('t2', 'c1', null)`)
    expect(flagKeys(await get())).toEqual(['children_consent_not_collected'])
    await db.query(`update dpdp.consent_token set acted_at = now() where id = 't1'`)
    expect(flagKeys(await get())).toEqual(['children_consent_not_collected']) // one family answered, one not: still flagged
    await db.query(`update dpdp.consent_token set acted_at = now() where id = 't2'`)
    expect(flagKeys(await get())).toEqual([])
    await save('school', { id: it.id, lawfulBasis: 'child_exemption' })
    expect(flagKeys(await get())).toEqual([])
    await save('school', { id: it.id, lawfulBasis: 'legal_obligation' })
    expect(flagKeys(await get())).toEqual(['children_basis_check'])
    await db.query(`delete from dpdp.consent_token`)
    await db.query(`delete from dpdp.consent_campaign`)
  })
  test('an outside helper without a signed agreement is flagged; a signed one is not', async () => {
    await as('owner@icp.test')
    const v = await save('school', { kind: 'vendor', name: 'School software firm', agreementStatus: 'requested' })
    expect(flagKeys(v.item)).toEqual(['vendor_agreement_missing'])
    const v2 = await save('school', { id: v.item.id, agreementStatus: 'signed', agreementRef: 'Agreement 2026-11', agreementOn: '2026-11-01' })
    expect(flagKeys(v2.item)).toEqual([])
  })
  test('a line not re-checked for over three weeks is flagged "stale"; confirming clears it', async () => {
    await as('owner@icp.test')
    const v = (await register('school')).find((i) => i.name === 'School software firm')!
    await db.query(`update dpdp.icp_item set first_seen_week = current_date - 60, last_confirmed_week = current_date - 40 where id = $1`, [v.id])
    expect(flagKeys((await register('school')).find((i) => i.id === v.id)!)).toEqual(['stale'])
    await one(`select public.dpdp_icp_confirm_items('school', array[$1]) as r`, [v.id])
    expect(flagKeys((await register('school')).find((i) => i.id === v.id)!)).toEqual([])
  })
  test('PARITY: the browser copy of the rules (dpdp-app/src/lib/icp.ts itemFlags) gives the same flags as the SQL function on 360 combinations, with and without a parent answer', async () => {
    await org('parity', 'institution')
    await member('parity', 'ownerp', 'owner')
    const week = (await rows<J>(`select dpdp.icp_week()::text as w`))[0].w as string
    const fresh = week
    const old = (await rows<J>(`select (dpdp.icp_week() - 40)::text as w`))[0].w as string
    let n = 0
    const wanted = new Map<string, string[]>()
    for (const kind of ['data_set', 'vendor', 'system'] as const)
      for (const children of [null, true, false] as const)
        for (const basis of [null, 'not_sure', 'consent', 'child_exemption', 'employment'] as const)
          for (const retention of ['none', 'days'] as const)
            for (const agreement of [null, 'signed'] as const)
              for (const stale of [false, true] as const) {
                const name = `Line ${++n}`
                const seen = stale ? old : fresh
                await db.query(
                  `insert into dpdp.icp_item (org_id, kind, name, first_seen_week, last_confirmed_week, principal_type, children, purpose, lawful_basis, retention_days, agreement_status)
                   values ('parity', $1, $2, $3, $3, 'student', $4, 'Teaching', $5, $6, $7)`,
                  [kind, name, seen, children, basis, retention === 'days' ? 365 : null, agreement])
                wanted.set(name, [kind, String(children), String(basis), retention, String(agreement), String(stale)])
              }
    for (const answered of [false, true]) {
      await db.query(`delete from dpdp.consent_token where id = 'pt'`)
      await db.query(`delete from dpdp.consent_campaign where id = 'pc'`)
      await db.query(`insert into dpdp.consent_campaign (id, org_id, principal_is_child) values ('pc', 'parity', true)`)
      await db.query(`insert into dpdp.consent_token (id, campaign_id, acted_at) values ('pt', 'pc', ${answered ? 'now()' : 'null'})`)
      await as('ownerp@icp.test')
      const reg = await register('parity')
      expect(reg).toHaveLength(360)
      for (const it of reg) {
        const w = wanted.get(it.name)!
        const mine = itemFlags({
          kind: it.kind, status: it.status, principalType: it.principalType, children: it.children, purpose: it.purpose, lawfulBasis: it.lawfulBasis,
          retentionDays: it.retentionDays, retentionNote: it.retentionNote, agreementStatus: it.agreementStatus, firstSeenWeek: it.firstSeenWeek, lastConfirmedWeek: it.lastConfirmedWeek,
        }, week, answered).sort()
        expect(flagKeys(it), `${it.name} ${w.join('|')} answered=${answered}`).toEqual(mine)
      }
    }
  }, 60_000)
  test("the job rule switches the children's-data jobs back ON (never off), and only when the register lists children", async () => {
    await org('school3', 'institution')
    await member('school3', 'owner3', 'owner')
    await db.query(`insert into dpdp.obligation_template (id, name, key, part) values ('k11','j11','institution-11',3), ('k12','j12','institution-12',3), ('k14','j14','institution-14',3)`)
    await db.query(`insert into dpdp.obligation (id, org_id, template_id, state, due_on, na_reason) values ('p11','school3','k11','not_applicable',current_date,'we have no children'), ('p12','school3','k12','open',current_date,null), ('p14','school3','k14','not_applicable',current_date,'x')`)
    await as('owner3@icp.test')
    expect((await one<J>(`select public.dpdp_icp_apply_rules('school3') as r`)).reopened).toBe(0) // no children listed yet: nothing moves
    await save('school3', { kind: 'person_group', name: 'Enrolled students', principalType: 'student', children: true })
    expect((await status('school3')).classify.steps.find((s: J) => s.key === 'jobs_follow_register').done).toBe(false)
    expect((await one<J>(`select public.dpdp_icp_apply_rules('school3') as r`)).reopened).toBe(1)
    expect((await rows<J>(`select id, state from dpdp.obligation where org_id = 'school3' order by id`))).toEqual([{ id: 'p11', state: 'open' }, { id: 'p12', state: 'open' }, { id: 'p14', state: 'not_applicable' }])
    expect((await status('school3')).classify.steps.find((s: J) => s.key === 'jobs_follow_register').done).toBe(true)
    await as('clerk@icp.test')
    expect(await fails(`select public.dpdp_icp_apply_rules('school')`)).toContain('Only the people who see the whole organisation')
  })
})

describe('the weekly checklist and record', () => {
  test('status: three stages, step counts, a percent, and an explicit "not a legal rating"', async () => {
    await as('owner@icp.test')
    const s = await status('school')
    expect(Object.keys(s).sort()).toEqual(['classify', 'done', 'identify', 'notALegalRating', 'percent', 'prove', 'runs', 'status', 'total', 'weekStart'])
    expect(s.notALegalRating).toBe(true)
    expect(s.identify.total).toBe(3)
    expect(s.classify.total).toBe(4)
    expect(s.prove.total).toBe(3)
    expect(s.total).toBe(10)
    expect(s.percent).toBe(Math.round((100 * s.done) / s.total))
    expect(['not_started', 'in_progress', 'complete']).toContain(s.status)
    expect(new Date(`${s.weekStart}T00:00:00Z`).getUTCDay()).toBe(1) // a Monday
  })
  test('a plain sign-off never ticks "anything new?"; only a "nothing new this week" from a person does; the run keeps a snapshot and the role (never an e-mail address); History carries no free text', async () => {
    await org('school4', 'institution')
    await member('school4', 'owner4', 'owner')
    await as('owner4@icp.test')
    const tick = async () => (await status('school4')).identify.steps.find((x: J) => x.key === 'anything_new').done
    expect(await tick()).toBe(false)
    await one(`select public.dpdp_icp_log('school4', 'identify', 'ok', 'Reviewed') as r`)
    expect(await tick()).toBe(false)
    await one(`select public.dpdp_icp_log('school4', 'identify', 'skipped', 'Nothing new this week') as r`)
    expect(await tick()).toBe(true)
    const runs = await rows<J>(`select stage, by_kind, outcome, note, actor_label, actor_identity_id, snapshot ->> 'percent' as p from dpdp.icp_run where org_id = 'school4' order by ran_at`)
    expect(runs[1]).toMatchObject({ stage: 'identify', by_kind: 'person', outcome: 'skipped', note: 'Nothing new this week', actor_label: 'Owner', actor_identity_id: 'i_owner4' })
    expect(runs[1].p).not.toBeNull()
    const ev = await rows<J>(`select kind, summary, detail, actor_label from dpdp.event where org_id = 'school4' order by occurred_at`)
    expect(ev.map((e) => e.summary)).toEqual(['Signed off Identify for the week', 'Recorded: nothing new this week'])
    expect(ev.every((e) => e.detail === null && e.actor_label === 'Owner')).toBe(true)
  })
  test('the weekly record is append-only; a person cannot record "failed" or a bad stage; only the service role can log as the helper, and only it', async () => {
    await as('owner4@icp.test')
    expect(await fails(`update dpdp.icp_run set outcome = 'failed' where org_id = 'school4'`)).toContain('append-only')
    expect(await fails(`delete from dpdp.icp_run where org_id = 'school4'`)).toContain('append-only')
    expect(await fails(`select public.dpdp_icp_log('school4', 'prove', 'failed', null)`)).toContain('Unknown outcome')
    expect(await fails(`select public.dpdp_icp_log('school4', 'bogus', 'ok', null)`)).toContain('Unknown stage')
    expect(await fails(`select public.dpdp_icp_log('school4', 'prove', 'ok', 'mail asha@example.com')`)).toContain('Leave out')
    const g = await rows<J>(`select grantee from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'dpdp_icp_run_software' and grantee in ('anon', 'authenticated', 'PUBLIC')`)
    expect(g).toEqual([])
    await asService()
    expect((await one<J>(`select public.dpdp_icp_run_software('school4', 'classify', 'partial', 'Counted by the Monday job') as r`)).ok).toBe(true)
    expect(await fails(`select public.dpdp_icp_run_software('nowhere', 'classify', 'ok', null)`)).toContain('Organisation not found')
    expect((await rows<J>(`select actor_label, actor_identity_id from dpdp.icp_run where by_kind = 'software'`))[0]).toEqual({ actor_label: 'Automatic helper', actor_identity_id: null })
  })
  test('while an organisation is being offboarded (exporting) its weekly record may be deleted with it; otherwise never', async () => {
    await db.exec(`create table if not exists dpdp.org_offboarding (org_id text primary key, state text not null)`)
    await asService()
    expect(await fails(`delete from dpdp.icp_run where org_id = 'school4'`)).toContain('append-only')
    await db.query(`insert into dpdp.org_offboarding (org_id, state) values ('school4', 'exporting')`)
    await db.query(`delete from dpdp.icp_run where org_id = 'school4'`)
    expect(await rows(`select 1 from dpdp.icp_run where org_id = 'school4'`)).toHaveLength(0)
    await db.query(`delete from dpdp.org_offboarding where org_id = 'school4'`)
  })
  test('register writes never put the item name in History (the chain can never be erased)', async () => {
    const ev = await rows<J>(`select summary, detail from dpdp.event where org_id = 'school'`)
    expect(ev.length).toBeGreaterThan(3)
    for (const e of ev) expect(`${e.summary} ${e.detail ?? ''}`).not.toMatch(/Student|Fee|admission|software/i)
  })
})

describe('the History chain', () => {
  test('every organisation chain replays cleanly after many writes through the locked writer', async () => {
    await as('owner@icp.test')
    for (let i = 0; i < 12; i++) await db.query(`select public.dpdp__append_event('school', 'i_owner', 'x', 'k', 'Event ' || $1::text)`, [i]).catch(() => {})
    const ev = await rows<J>(`select actor_label, detail, kind, occurred_at, org_id, prev_hash, summary, hash from dpdp.event where org_id = 'school' order by occurred_at asc`)
    let prev: string | null = null
    for (const e of ev) {
      expect(e.prev_hash).toBe(prev)
      const stamp = (e.occurred_at as Date).toISOString()
      const canon = `{"actorLabel":${JSON.stringify(e.actor_label)},"detail":${e.detail === null ? 'null' : JSON.stringify(e.detail)},"kind":${JSON.stringify(e.kind)},"occurredAt":${JSON.stringify(stamp)},"orgId":${JSON.stringify(e.org_id)},"prevHash":${prev === null ? 'null' : JSON.stringify(prev)},"summary":${JSON.stringify(e.summary)}}`
      expect(sha(`${prev ?? ''}${canon}`)).toBe(e.hash)
      prev = e.hash
    }
  })
})

describe('roll-back', () => {
  test('removes the tables, the functions and the mirrored rows, and restores the writer without the lock', async () => {
    await db.exec(read(DOWN))
    expect((await rows<J>(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname like 'icp\\_%'`))[0].n).toBe(0)
    expect((await rows<J>(`select count(*)::int as n from pg_proc where proname like 'dpdp\\_icp\\_%' or proname like 'icp\\_%'`))[0].n).toBe(0)
    expect((await rows<J>(`select count(*)::int as n from dpdp.data_category where id like 'icp\\_c\\_%'`))[0].n).toBe(0)
    expect(((await rows<J>(`select prosrc from pg_proc where proname = 'dpdp__append_event'`))[0].prosrc as string).includes('pg_advisory_xact_lock')).toBe(false)
  })
})
