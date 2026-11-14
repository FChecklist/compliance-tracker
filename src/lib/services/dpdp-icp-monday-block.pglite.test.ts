/// <reference types="bun-types" />
// DPDP ICP weekly lifecycle, slice 3 (drizzle/0763): the data the Monday e-mail's ICP block is built from. Offline proof on PGlite; the live database is never touched.
// 0761 and 0762 (and the real breach migration 0726) run first, then the WHOLE of 0763 twice.
// Run: bun test --isolate src/lib/services/dpdp-icp-monday-block.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, fnFrom, read } from './dpdp-pglite-base'

const DOWN = 'drizzle/down/0763_dpdp_icp_monday_block.down.sql'
let db: PGlite
type J = Record<string, any>
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.role', '', false)`, [JSON.stringify(email ? { email } : {})])
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const fails = async (sql: string, params: unknown[] = []) => { try { await db.query(sql, params); return null } catch (e) { return (e as Error).message } }
const weekly = (orgId: string, now: string | null = null, record = true) => one<J>(`select public.dpdp_timer_icp_weekly($1, $2::timestamptz, $3) as r`, [orgId, now, record])
const save = (orgId: string, item: J) => one<J>(`select public.dpdp_icp_save_item($1, $2::jsonb) as r`, [orgId, JSON.stringify(item)])

async function person(key: string) {
  const email = `${key}@mon.test`
  await db.query(`insert into dpdp.identity (id, primary_email) values ($1, $2) on conflict do nothing`, [`i_${key}`, email])
  await db.query(`insert into dpdp.identity_email (id, identity_id, email, is_primary) values ($1, $2, $3, true) on conflict do nothing`, [`ie_${key}`, `i_${key}`, email])
}
async function org(key: string, ownerKey: string, product: string | null = 'institution') {
  await db.query(`insert into dpdp.organisation (id, name, slug, product) values ($1, $2, $1, $3)`, [key, `Org ${key}`, product])
  await person(ownerKey)
  await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via, first_visit_seen_at) values ($1, $2, $3, 'owner', 'created', now())`, [`m_${key}`, `i_${ownerKey}`, key])
}
const mondayOf = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x }
// the clients ONE recipient (a membership) acts for: the database keys them per person, never as one list for the whole firm
const mineOf = (w: J, membershipId: string): { clientTotal: number; clients: J[] } => w.clientsByViewer?.[membershipId] ?? { clientTotal: 0, clients: [] }
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  await db.exec(`
    alter table dpdp.obligation_template add column key text, add column part integer, add column data_set text, add column role_tag text;
    alter table dpdp.obligation add column assigned_person_id text;
    alter table dpdp.organisation add column set_up_by_membership_id text, add column owner_confirmed_at timestamp;
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
    create type dpdp.relationship_kind as enum ('advises', 'processes_for', 'audits', 'adjudicates');
    create table dpdp.relationship (id text primary key, from_org text not null, to_org text not null, kind dpdp.relationship_kind not null, ended_at timestamp);
    ${fnFrom('drizzle/0607_dpdp_wo012_ai_link.sql', 'dpdp__viewer_kind')}
  `)
  await db.exec(read('drizzle/0726_dpdp_breach_rule7_fields.sql'))
  await db.exec(read('drizzle/0761_dpdp_icp_identify_classify.sql'))
  await db.exec(read('drizzle/0762_dpdp_icp_prove.sql'))
  await db.exec(read('drizzle/0763_dpdp_icp_monday_block.sql'))
  await db.exec(read('drizzle/0763_dpdp_icp_monday_block.sql')) // re-runnable
  await org('school', 'owner')
  await person('clerk')
  await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_school_clerk', 'i_clerk', 'school', 'staff', 'created')`)
}, 120_000)

describe('the e-mail block data', () => {
  test('closed to every browser role; only the timer (service role) may call it; an unknown organisation is refused', async () => {
    const g = await rows<J>(`select grantee from information_schema.routine_privileges where routine_name = 'dpdp_timer_icp_weekly' and grantee in ('anon', 'authenticated', 'PUBLIC')`)
    expect(g).toEqual([])
    const s = await rows<J>(`select grantee from information_schema.routine_privileges where routine_name = 'dpdp_timer_icp_weekly' and grantee = 'service_role'`)
    expect(s.length).toBeGreaterThan(0)
    expect(await fails(`select public.dpdp_timer_icp_weekly('nowhere', null, false)`)).toContain('Organisation not found')
  })

  test('the status is cut into the three stages with their steps; the score is a count of steps and says it is not a legal rating; only whole-organisation members are viewers', async () => {
    const w = await weekly('school', null, false)
    expect(w.stages.map((s: J) => s.stage)).toEqual(['identify', 'classify', 'prove'])
    expect(w.stages.map((s: J) => s.total)).toEqual([3, 4, 7])
    expect(w.total).toBe(14)
    expect(w.percent).toBe(Math.round((100 * w.done) / w.total))
    expect(w.notALegalRating).toBe(true)
    expect(w.note).toContain('not a rating')
    expect(w.viewerMembershipIds).toEqual(['m_school'])
    expect(new Date(`${w.weekStart}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(w.clients).toEqual([])
    expect(w.clientsByViewer).toEqual({})
    expect(w.snapshotsAdded).toBe(0)
    expect(JSON.stringify(w)).not.toMatch(/@/)
  })

  test('the weekly proof snapshot adds one software run per stage once a week, never twice, and nothing when told not to', async () => {
    expect((await weekly('school', null, true)).snapshotsAdded).toBe(3)
    expect((await weekly('school', null, true)).snapshotsAdded).toBe(0)
    const runs = await rows<J>(`select stage, by_kind, outcome, note, actor_label, snapshot ? 'percent' as has from dpdp.icp_run where org_id = 'school' order by stage`)
    expect(runs).toEqual([
      { stage: 'classify', by_kind: 'software', outcome: 'ok', note: 'Monday snapshot', actor_label: 'Automatic helper', has: true },
      { stage: 'identify', by_kind: 'software', outcome: 'ok', note: 'Monday snapshot', actor_label: 'Automatic helper', has: true },
      { stage: 'prove', by_kind: 'software', outcome: 'ok', note: 'Monday snapshot', actor_label: 'Automatic helper', has: true },
    ])
    await org('quiet', 'quietowner')
    await weekly('quiet', null, false)
    expect(await rows(`select 1 from dpdp.icp_run where org_id = 'quiet'`)).toHaveLength(0)
  })

  test('carry-over lists a step that is not done now and was not done in the latest earlier record; a step done since is not carried; the first week carries nothing', async () => {
    await org('carry', 'carryowner')
    const thisWeek = mondayOf(new Date())
    expect((await weekly('carry', null, false)).carriedOver).toEqual([])
    const lastWeek = addDays(thisWeek, -7)
    await db.query(`insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, outcome, snapshot)
                    values ('carry', 'identify', $1, 'person', 'Owner', 'ok', dpdp.icp_status_for('carry', $1::date) - 'notALegalRating')`, [ymd(lastWeek)])
    const w = await weekly('carry', null, false)
    const keys = w.carriedOver.map((c: J) => `${c.stage}.${c.key}`)
    expect(keys).toContain('identify.register_started')
    expect(keys).toContain('classify.classify_items')
    expect(w.carriedOver.every((c: J) => typeof c.label === 'string' && c.label.length > 3)).toBe(true)
    // the owner lists something this week: that step is no longer open, so it is no longer carried
    await as('carryowner@mon.test')
    await save('carry', { kind: 'data_set', name: 'Student admission files', whereHeld: 'Office cabinet' })
    const w2 = await weekly('carry', null, false)
    expect(w2.carriedOver.map((c: J) => `${c.stage}.${c.key}`)).not.toContain('identify.register_started')
  })

  // the real client model (0609): a member of the firm holds a membership in the client organisation AND is named on a live CAPARTNER / CAMGR job there
  async function addClient(firm: string, firmPersonKey: string, client: string, opts: { confirmed?: boolean; tag?: string; setUpBy?: boolean; noJob?: boolean } = {}) {
    await org(client, `${client}owner`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ($1, $2, $3, 'staff', 'created') on conflict do nothing`, [`m_${client}_ca`, `i_${firmPersonKey}`, client])
    if (!opts.noJob) {
      await db.query(`insert into dpdp.obligation_template (id, name, role_tag) values ($1, 'CA job', $2) on conflict do nothing`, [`t_${opts.tag ?? 'CAPARTNER'}`, opts.tag ?? 'CAPARTNER'])
      await db.query(`insert into dpdp.obligation (id, org_id, template_id, state, due_on, assigned_person_id) values ($1, $2, $3, 'open', current_date + 30, $4)`, [`ob_${client}`, client, `t_${opts.tag ?? 'CAPARTNER'}`, `i_${firmPersonKey}`])
    }
    if (opts.setUpBy) await db.query(`update dpdp.organisation set set_up_by_membership_id = $2, owner_confirmed_at = $3 where id = $1`, [client, `m_${client}_ca`, opts.confirmed ? new Date().toISOString() : null])
  }

  test('a Professional (firm) organisation gets a per-client roll-up of counts only, worst first, only clients its own people really act for and whose owner confirmed; never a register line', async () => {
    await org('caf', 'cafowner', 'firm')
    await addClient('caf', 'cafowner', 'cl1')
    await addClient('caf', 'cafowner', 'cl2')
    await addClient('caf', 'cafowner', 'cl3', { setUpBy: true, confirmed: false }) // set up by the CA, the client's owner has not confirmed: not shown
    await addClient('caf', 'cafowner', 'cl5', { setUpBy: true, confirmed: true })
    await addClient('caf', 'cafowner', 'cl6', { tag: 'OTHER' }) // named on a job, but not a CA job: not a client
    await org('cl4', 'cl4owner') // an organisation with no tie to the firm at all
    await db.query(`insert into dpdp.relationship (id, from_org, to_org, kind, ended_at) values ('r1', 'caf', 'cl4', 'advises', null)`) // a declared relationship alone gives a firm nothing
    await as('cl2owner@mon.test')
    await save('cl2', { kind: 'data_set', name: 'Hidden client list', whereHeld: 'Secret cabinet' })
    await one(`select public.dpdp_icp_log('cl2', 'identify', 'skipped', 'Secret note') as r`)
    const w = await weekly('caf', null, false)
    const mine = mineOf(w, 'm_caf')
    expect(w.clients).toEqual([]) // never one list for the whole firm
    expect(mine.clientTotal).toBe(3)
    expect(mine.clients.map((c: J) => c.orgId).sort()).toEqual(['cl1', 'cl2', 'cl5'])
    expect(mine.clients[0].percent).toBeLessThanOrEqual(mine.clients[1].percent)
    const cl2 = mine.clients.find((c: J) => c.orgId === 'cl2')
    expect(cl2.started).toBe(true)
    expect(cl2.total).toBe(14)
    expect(mine.clients.find((c: J) => c.orgId === 'cl1').started).toBe(false)
    expect(JSON.stringify(w)).not.toMatch(/Hidden client list|Secret/)
    expect((await weekly('cl1', null, false)).clientsByViewer).toEqual({}) // an institution never gets a roll-up
  })

  test('more than 100 clients: the cut keeps the weakest 100, not the first 100 by name', async () => {
    await org('big', 'bigowner', 'firm')
    await db.query(`insert into dpdp.obligation_template (id, name, role_tag) values ('t_CAPARTNER', 'CA job', 'CAPARTNER') on conflict do nothing`)
    await db.query(`insert into dpdp.organisation (id, name, slug, product) select 'bc' || g, 'Client ' || lpad(g::text, 3, '0'), 'bc' || g, 'institution' from generate_series(1, 105) g`)
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) select 'mbc' || g, 'i_bigowner', 'bc' || g, 'staff', 'created' from generate_series(1, 105) g`)
    await db.query(`insert into dpdp.obligation (id, org_id, template_id, state, due_on, assigned_person_id) select 'obc' || g, 'bc' || g, 't_CAPARTNER', 'open', current_date + 30, 'i_bigowner' from generate_series(1, 105) g`)
    // the first 50 have started their register (a higher score); the last 55 have not, so the weakest clients are the ones LAST by name
    await db.query(`insert into dpdp.icp_item (org_id, kind, name, first_seen_week) select 'bc' || g, 'data_set', 'Admission files', dpdp.icp_week() from generate_series(1, 50) g`)
    const w = await weekly('big', null, false)
    const mine = mineOf(w, 'm_big')
    expect(mine.clientTotal).toBe(105)
    expect(mine.clients).toHaveLength(100)
    const pcts = mine.clients.map((c: J) => c.percent)
    expect([...pcts].sort((a: number, b: number) => a - b)).toEqual(pcts)
    expect(pcts[0]).toBeLessThan(pcts[99]) // the scores really differ, so the cut is a ranking and not a tie
    const got = mine.clients.map((c: J) => c.orgId)
    for (const g of [101, 102, 103, 104, 105]) expect(got).toContain(`bc${g}`) // the weakest by score, last by name: kept
  }, 120_000)

  test('every recipient is shown only the clients THEY act for: a CA\'s e-mail named in a made-up firm gives that firm\'s owner nothing, whatever the CA taps', async () => {
    await org('goodf', 'vic', 'firm')
    await addClient('goodf', 'vic', 'vc1')
    await addClient('goodf', 'vic', 'vc2')
    await org('evil', 'evilowner', 'firm')
    await person('vic2')
    // the owner of a made-up firm names the victim CA's e-mail as a co-owner and another as plain staff: memberships appear with no act of the CAs
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_evil_vic', 'i_vic', 'evil', 'owner', 'invited'), ('m_evil_vic2', 'i_vic2', 'evil', 'staff', 'named_in_role')`)
    for (const stamp of [false, true]) {
      if (stamp) await db.query(`update dpdp.membership set first_visit_seen_at = now() where id in ('m_evil_vic', 'm_evil_vic2')`) // even after the welcome screen was dismissed
      const w = await weekly('evil', null, false)
      expect(w.clients).toEqual([])
      expect(mineOf(w, 'm_evil').clientTotal).toBe(0) // the attacker's own list: nothing
      expect(w.clientsByViewer.m_evil).toBeUndefined()
      expect(w.clientsByViewer.m_evil_vic2).toBeUndefined() // plain staff are not recipients of the block at all
      expect(mineOf(w, 'm_evil_vic').clientTotal).toBe(2) // the CA herself, in her own e-mail, sees her own clients
      // nothing of the CA's clients sits under any other recipient's key
      expect(JSON.stringify(Object.fromEntries(Object.entries(w.clientsByViewer).filter(([k]) => k !== 'm_evil_vic')))).not.toMatch(/vc1|vc2|Org vc/)
    }
    expect(mineOf(await weekly('goodf', null, false), 'm_goodf').clientTotal).toBe(2)
  })

  test('a client the CA set up (school or university: the library has no CA-tagged job) counts once the owner confirmed; a departed CA or a departed firm membership drops them', async () => {
    await org('caf2', 'caf2owner', 'firm')
    await addClient('caf2', 'caf2owner', 'sch1', { noJob: true, setUpBy: true, confirmed: true })
    await addClient('caf2', 'caf2owner', 'sch2', { noJob: true, setUpBy: true, confirmed: false }) // not confirmed: not shown
    await addClient('caf2', 'caf2owner', 'sch3', { noJob: true }) // no job, not set up by the CA: no tie at all
    const w = await weekly('caf2', null, false)
    expect(mineOf(w, 'm_caf2').clients.map((c: J) => c.orgId)).toEqual(['sch1'])
    await db.query(`update dpdp.membership set state = 'revoked' where id = 'm_sch1_ca'`)
    expect(mineOf(await weekly('caf2', null, false), 'm_caf2').clientTotal).toBe(0)
    await db.query(`update dpdp.membership set state = 'active' where id = 'm_sch1_ca'`)
    expect(mineOf(await weekly('caf2', null, false), 'm_caf2').clientTotal).toBe(1)
    await db.query(`update dpdp.membership set state = 'revoked' where id = 'm_caf2'`)
    expect(mineOf(await weekly('caf2', null, false), 'm_caf2').clientTotal).toBe(0)
  })

  test('a firm with no product value is treated as a firm, like My clients does (the block says so, so the e-mail shows the roll-up)', async () => {
    await org('np', 'npowner', null)
    await org('npc', 'npcowner')
    await db.query(`insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values ('m_npc_ca', 'i_npowner', 'npc', 'staff', 'created')`)
    await db.query(`update dpdp.organisation set set_up_by_membership_id = 'm_npc_ca', owner_confirmed_at = now() where id = 'npc'`)
    const w = await weekly('np', null, false)
    expect(w.product).toBe('firm')
    expect(mineOf(w, 'm_np').clients.map((c: J) => c.orgId)).toEqual(['npc'])
  })

  test('the clients helper is closed to every browser role', async () => {
    expect((await rows<J>(`select has_function_privilege('anon', 'dpdp.icp_clients_of(text, text)', 'execute') as a, has_function_privilege('authenticated', 'dpdp.icp_clients_of(text, text)', 'execute') as b`))[0]).toEqual({ a: false, b: false })
  })

  test('carry-over never lists the steps that are open for everyone on a Monday (anything new, a record this week, the week sign-off)', async () => {
    await org('wk', 'wkowner')
    const lastWeek = addDays(mondayOf(new Date()), -7)
    await db.query(`insert into dpdp.icp_item (org_id, kind, name, first_seen_week, last_confirmed_week) values ('wk', 'data_set', 'Old files', $1, null)`, [ymd(addDays(lastWeek, -14))])
    await db.query(`insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, outcome, snapshot)
                    values ('wk', 'identify', $1, 'person', 'Owner', 'ok', dpdp.icp_status_for('wk', $1::date) - 'notALegalRating')`, [ymd(lastWeek)])
    await db.query(`insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, outcome, snapshot)
                    values ('wk', 'prove', $1, 'person', 'Owner', 'ok', dpdp.icp_status_for('wk', $1::date) - 'notALegalRating')`, [ymd(lastWeek)])
    const keys = (await weekly('wk', null, false)).carriedOver.map((c: J) => c.key)
    expect(keys).not.toContain('confirm_register') // a week-scoped step: open for every organisation with a register on a Monday
    expect(keys).not.toContain('week_signed_off')
    expect(keys).not.toContain('evidence_this_week')
    expect(keys).not.toContain('anything_new')
  })

  test('a date in the past passed in never writes a snapshot, and a second run for the same week adds nothing (the unique index)', async () => {
    await org('snap', 'snapowner')
    expect((await weekly('snap', '2026-01-05T00:30:00Z', true)).snapshotsAdded).toBe(0)
    expect(await rows(`select 1 from dpdp.icp_run where org_id = 'snap'`)).toHaveLength(0)
    expect((await weekly('snap', null, true)).snapshotsAdded).toBe(3)
    expect((await weekly('snap', null, true)).snapshotsAdded).toBe(0)
    expect(await fails(`insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, outcome, note, snapshot) values ('snap', 'identify', dpdp.icp_week(), 'software', 'x', 'ok', 'Monday snapshot', '{}'::jsonb)`)).toContain('icp_run_monday_once')
  })

  test('the week follows the date given, in UTC, Monday to Sunday', async () => {
    const w = await weekly('school', '2026-11-15T23:59:00Z', false) // a Sunday
    expect(w.weekStart).toBe('2026-11-09')
    expect((await weekly('school', '2026-11-16T00:00:00Z', false)).weekStart).toBe('2026-11-16')
  })
})

describe('roll-back', () => {
  test('drops the function and nothing else (the snapshots it added stay: the weekly record is append-only)', async () => {
    await db.exec(read(DOWN))
    expect((await rows<J>(`select count(*)::int as n from pg_proc where proname = 'dpdp_timer_icp_weekly'`))[0].n).toBe(0)
    expect((await rows<J>(`select count(*)::int as n from dpdp.icp_run where note = 'Monday snapshot'`))[0].n).toBeGreaterThan(0)
  })
})
