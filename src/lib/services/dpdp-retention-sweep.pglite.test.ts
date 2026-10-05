/// <reference types="bun-types" />
// drizzle/0700 on PGlite (real Postgres as WASM; no live database touched): the retention sweep and organisation offboarding.
//   * DRY-RUN BY DEFAULT: with the shipped setting (live = false) the sweep only counts and writes a count report; nothing is deleted;
//   * once live = true it deletes exactly what is past its period (sign-in codes, sessions, confirm links, sent-mail log, CLOSED inbound mail,
//     network-prefix records) and keeps everything inside its period and every open ticket; p_force_dry_run overrides live;
//   * offboarding: operator-only; an organisation's data goes only after the export period AND an export; parent/child tables are deleted in a
//     foreign-key-safe order; the append-only event log is never touched; an organisation row that a kept record still points at is kept and reported;
//   * the roll-back removes everything.
// Run: bun test --isolate src/lib/services/dpdp-retention-sweep.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const up = read('0700_dpdp_retention_sweep_and_offboarding.sql')
const down = read('down/0700_dpdp_retention_sweep_and_offboarding.down.sql')

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const count = async (t: string) => (await q<{ n: number }>(`select count(*)::int as n from dpdp.${t}`))[0].n
const sweep = async (force = false) => (await q<{ r: any }>(`select public.dpdp_timer_retention_sweep($1) as r`, [force]))[0].r

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin;
    create schema dpdp;
    create function public.dpdp__is_platform_admin() returns boolean language sql as $f$ select coalesce(current_setting('test.admin', true), '') = 'yes' $f$;
    create table dpdp.organisation (id text primary key, name text);
    create table dpdp.event (id text primary key, org_id text references dpdp.organisation (id), what text);
    create function dpdp.event_guard() returns trigger language plpgsql as $f$ begin raise exception 'event is append-only' using errcode = '42501'; end $f$;
    create trigger event_guard before update or delete on dpdp.event for each row execute function dpdp.event_guard();
    -- a parent that sorts BEFORE its child, so a naive alphabetical delete fails and the retry order has to work
    create table dpdp.aa_parent (id text primary key, org_id text references dpdp.organisation (id));
    create table dpdp.zz_child (id text primary key, org_id text references dpdp.organisation (id), parent_id text references dpdp.aa_parent (id));
    create table dpdp.login_token (id text primary key, expires_at timestamp not null);
    create table dpdp.session (id text primary key, expires_at timestamp not null);
    create table dpdp.email_token (id text primary key, expires_at timestamp not null);
    create table dpdp.mail_outbound (id text primary key, sent_at timestamptz not null);
    create table dpdp.mail_inbound (id text primary key, closed_at timestamptz);
    create table dpdp.ai_link_seen (link_id text, kind text, value text, first_seen_at timestamp not null, primary key (link_id, kind, value));

    insert into dpdp.login_token values ('lt-old', now() - interval '40 days'), ('lt-new', now() - interval '2 days');
    insert into dpdp.session values ('s-old', now() - interval '31 days'), ('s-new', now() + interval '5 days');
    insert into dpdp.email_token values ('et-old', now() - interval '45 days'), ('et-new', now());
    insert into dpdp.mail_outbound values ('mo-old', now() - interval '14 months'), ('mo-new', now() - interval '6 months');
    insert into dpdp.mail_inbound values ('mi-old-closed', now() - interval '25 months'), ('mi-recent-closed', now() - interval '3 months'), ('mi-open-ancient', null);
    insert into dpdp.ai_link_seen values ('l1','ip','203.0.113', now() - interval '100 days'), ('l1','ip','198.51.100', now() - interval '10 days'), ('l1','ua','curl', now() - interval '200 days');

    insert into dpdp.organisation values ('orgA', 'Ended Co'), ('orgB', 'Live Co');
    insert into dpdp.event values ('e1', 'orgA', 'created');
    insert into dpdp.aa_parent values ('p1', 'orgA'), ('p9', 'orgB');
    insert into dpdp.zz_child values ('c1', 'orgA', 'p1'), ('c9', 'orgB', 'p9');
  `)
  await db.exec(up)
}, 120_000)

describe('dry-run by default', () => {
  test('the shipped setting is live = false, and the sweep counts but deletes nothing', async () => {
    expect((await q<{ live: boolean }>(`select live from dpdp.retention_setting where id = 1`))[0].live).toBe(false)
    const before = { lt: await count('login_token'), mo: await count('mail_outbound') }
    const r = await sweep()
    expect(r.live).toBe(false)
    expect(r.counts).toEqual({ login_token: 1, session: 1, email_token: 1, mail_outbound: 1, mail_inbound_closed: 1, ai_link_seen: 2 })
    expect({ lt: await count('login_token'), mo: await count('mail_outbound') }).toEqual(before)
    expect(await count('retention_run')).toBe(1)
    expect((await q<{ live: boolean }>(`select live from dpdp.retention_run order by id desc limit 1`))[0].live).toBe(false)
  })
})

describe('live: only what is past its period goes', () => {
  test('p_force_dry_run overrides live', async () => {
    await db.exec(`update dpdp.retention_setting set live = true where id = 1`)
    const r = await sweep(true)
    expect(r.live).toBe(false)
    expect(await count('login_token')).toBe(2)
  })
  test('a live sweep deletes the old rows and keeps the recent ones and the open ticket', async () => {
    const r = await sweep()
    expect(r.live).toBe(true)
    expect((await q<{ id: string }>(`select id from dpdp.login_token`)).map((x) => x.id)).toEqual(['lt-new'])
    expect((await q<{ id: string }>(`select id from dpdp.session`)).map((x) => x.id)).toEqual(['s-new'])
    expect((await q<{ id: string }>(`select id from dpdp.email_token`)).map((x) => x.id)).toEqual(['et-new'])
    expect((await q<{ id: string }>(`select id from dpdp.mail_outbound`)).map((x) => x.id)).toEqual(['mo-new'])
    expect((await q<{ id: string }>(`select id from dpdp.mail_inbound order by id`)).map((x) => x.id)).toEqual(['mi-open-ancient', 'mi-recent-closed'])
    expect((await q<{ value: string }>(`select value from dpdp.ai_link_seen order by value`)).map((x) => x.value)).toEqual(['198.51.100'])
  })
  test('running it again deletes nothing more', async () => {
    const r = await sweep()
    expect(Object.values(r.counts as Record<string, number>).every((n) => n === 0)).toBe(true)
  })
})

describe('organisation offboarding', () => {
  const asOperator = async <T>(fn: () => Promise<T>) => { await db.exec(`select set_config('test.admin', 'yes', false)`); try { return await fn() } finally { await db.exec(`select set_config('test.admin', '', false)`) } }
  test('only the operator can start or export', async () => {
    await expect(db.query(`select public.dpdp_operator_offboard_start('orgA')`)).rejects.toThrow(/Only the platform operator/)
    await expect(db.query(`select public.dpdp_operator_offboard_export('orgA')`)).rejects.toThrow(/Only the platform operator/)
  })
  test('start sets a 30-day export period; the sweep leaves the organisation alone until it has passed', async () => {
    const r = await asOperator(async () => (await q<{ r: any }>(`select public.dpdp_operator_offboard_start('orgA') as r`))[0].r)
    expect(r.orgId).toBe('orgA')
    const days = (await q<{ d: number }>(`select extract(epoch from (export_until - started_at))/86400 as d from dpdp.org_offboarding where org_id = 'orgA'`))[0].d
    expect(Math.round(Number(days))).toBe(30)
    const s = await sweep()
    expect(s.organisations).toEqual([])
    expect(await count('zz_child')).toBe(2)
  })
  test('export returns the organisation\'s rows (and only its own) and stamps exported_at', async () => {
    const ex = await asOperator(async () => (await q<{ r: any }>(`select public.dpdp_operator_offboard_export('orgA') as r`))[0].r)
    expect(Object.keys(ex.tables).sort()).toEqual(['aa_parent', 'event', 'zz_child'])
    expect(ex.tables.zz_child.map((x: { id: string }) => x.id)).toEqual(['c1'])
    expect((await q<{ e: string | null }>(`select exported_at::text as e from dpdp.org_offboarding where org_id = 'orgA'`))[0].e).not.toBeNull()
  })
  test('after the period AND an export: a dry-run counts, then a live sweep deletes child before parent, keeps the event log and the organisation row it points at', async () => {
    await db.exec(`update dpdp.org_offboarding set export_until = now() - interval '1 day' where org_id = 'orgA'`)
    await db.exec(`update dpdp.retention_setting set live = false where id = 1`)
    const dry = await sweep()
    expect(dry.organisations[0]).toMatchObject({ orgId: 'orgA', live: false, wouldDeleteOrDeleted: { aa_parent: 1, zz_child: 1 }, kept: { event: 1 } })
    expect(await count('zz_child')).toBe(2)
    await db.exec(`update dpdp.retention_setting set live = true where id = 1`)
    const live = await sweep()
    expect(live.organisations[0]).toMatchObject({ orgId: 'orgA', live: true, organisationRowDeleted: false })
    expect(live.organisations[0].note).toMatch(/organisation row kept/)
    expect((await q<{ id: string }>(`select id from dpdp.zz_child`)).map((x) => x.id)).toEqual(['c9'])
    expect((await q<{ id: string }>(`select id from dpdp.aa_parent`)).map((x) => x.id)).toEqual(['p9'])
    expect(await count('event')).toBe(1)
    expect((await q<{ id: string }>(`select id from dpdp.organisation order by id`)).map((x) => x.id)).toEqual(['orgA', 'orgB'])
    expect((await q<{ state: string }>(`select state from dpdp.org_offboarding where org_id = 'orgA'`))[0].state).toBe('deleted')
  })
  test('the other organisation is never touched, and the finished one is not swept again', async () => {
    expect(await count('zz_child')).toBe(1)
    const again = await sweep()
    expect(again.organisations).toEqual([])
  })
  test('an organisation with no kept record pointing at it is deleted whole', async () => {
    await db.exec(`insert into dpdp.organisation values ('orgC', 'Gone Co'); insert into dpdp.aa_parent values ('p3', 'orgC'); insert into dpdp.zz_child values ('c3', 'orgC', 'p3')`)
    await asOperator(async () => { await db.query(`select public.dpdp_operator_offboard_start('orgC')`); await db.query(`select public.dpdp_operator_offboard_export('orgC')`) })
    await db.exec(`update dpdp.org_offboarding set export_until = now() - interval '1 day' where org_id = 'orgC'`)
    const r = await sweep()
    expect(r.organisations[0]).toMatchObject({ orgId: 'orgC', organisationRowDeleted: true, note: null })
    expect((await q<{ id: string }>(`select id from dpdp.organisation order by id`)).map((x) => x.id)).toEqual(['orgA', 'orgB'])
  })
  test('an organisation that was never exported is never deleted, however old', async () => {
    await db.exec(`insert into dpdp.organisation values ('orgD', 'Unexported Co'); insert into dpdp.org_offboarding (org_id, export_until) values ('orgD', now() - interval '90 days')`)
    const r = await sweep()
    expect(r.organisations).toEqual([])
    expect(await count('organisation')).toBe(3)
  })
})

describe('roll-back', () => {
  test('removes the functions and the three tables', async () => {
    await db.exec(down)
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_proc where proname in ('dpdp_timer_retention_sweep', 'dpdp__offboard_delete', 'dpdp_operator_offboard_start', 'dpdp_operator_offboard_export')`))[0].n).toBe(0)
    for (const t of ['retention_setting', 'retention_run', 'org_offboarding']) expect((await q<{ t: string | null }>(`select to_regclass('dpdp.${t}')::text as t`))[0].t).toBeNull()
  })
})
