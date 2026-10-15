/// <reference types="bun-types" />
// drizzle/0733 on PGlite (real Postgres as WASM): the DPDP visitor-journey tables and RPCs. Proves ingest (sessions, events, exits, returning visits by visitor id and by keyed ip hash,
// bots kept apart, caps, a stolen session id refused), the rate limit, the count-only path, linking a visitor to an identity id, the funnel (visit -> key page -> CTA -> sign-up ->
// organisation -> first-visit wizard -> paid, by first-touch source, later stages imply earlier ones, a payment from before the first visit does not count), the owner report,
// one visitor's journey, the 365-day retention (aggregates written first, raw rows gone, links gone, nothing identifying in the aggregates, a second run adds nothing) and that
// no browser-facing role can read or call any of it. The migration is applied exactly as written (only its pg_cron block is skipped by its own guard).
//
// Run: bun test --isolate src/lib/services/dpdp-visitor-journey.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../../../drizzle/0733_dpdp_visitor_journey.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const one = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await q<T>(sql, args))[0] as T
const rpc = async (fn: string, ...args: unknown[]): Promise<any> => (await one<{ r: any }>(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)).r

const VID1 = 'a1'.repeat(12), VID2 = 'b2'.repeat(12), VID3 = 'c3'.repeat(12), VID4 = 'd4'.repeat(12), VID5 = 'e5'.repeat(12)
const hash = (n: number) => String(n).padStart(2, '0').repeat(32)
const sid = (n: number) => String(n).padStart(2, '0').repeat(8)
const ingest = (over: Record<string, unknown> = {}) =>
  rpc('dpdp_visit_ingest', { sid: sid(1), vid: VID1, ip_short: '203.0.113.0', ip_hash: hash(1), source_kind: 'search', search_engine: 'Google', referrer_host: 'www.google.com', landing_path: '/', device: 'desktop', language: 'en-in', country: 'IN', city: 'Pune', is_bot: false, events: [{ k: 'pv', p: '/' }], ...over })

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin;
    create schema dpdp; grant usage on schema dpdp to app_runtime, service_role, anon, authenticated; grant usage on schema public to anon, authenticated;
    create table dpdp.identity (id text primary key, primary_email text);
    create table dpdp.identity_email (id text primary key, identity_id text, email text, is_primary boolean default true);
    create table dpdp.membership (id text primary key, identity_id text, org_id text, level text, state text default 'active', first_visit_seen_at timestamp, said_not_me_at timestamp, created_at timestamp default now());
    create table dpdp.event (id text primary key default replace(gen_random_uuid()::text,'-',''), org_id text, actor_identity_id text, kind text, occurred_at timestamp not null default (now() at time zone 'UTC'));
    insert into dpdp.identity values ('i1','founder@acme.in'), ('i2','buyer@beta.in'), ('i3','late@gamma.in');
    insert into dpdp.identity_email values ('e1','i1','Founder@Acme.in',true), ('e2','i2','buyer@beta.in',true), ('e3','i3','late@gamma.in',true);
  `)
  await db.exec(migration)
}, 120_000)

describe('ingest', () => {
  test('a first beacon creates the session with where it came from, and the page view is kept', async () => {
    const r = await ingest({ utm: { campaign: 'launch-oct', medium: 'cpc' } })
    expect(r.ok).toBe(true); expect(r.visit_no).toBe(1); expect(r.events).toBe(1)
    const s = await one<any>(`select * from dpdp.visit_session where id = $1`, [sid(1)])
    expect(s).toMatchObject({ visitor_id: VID1, source_kind: 'search', search_engine: 'Google', landing_path: '/', country: 'IN', city: 'Pune', device: 'desktop', is_bot: false, utm_campaign: 'launch-oct', ip_short: '203.0.113.0' })
    expect(s.exit_path).toBe('/')
  })
  test('sections, a call to action, a choice and an exit land as events; the exit sets where, how long and how far', async () => {
    const r = await ingest({ events: [{ k: 'sec', p: '/', n: 'how', ms: 12000 }, { k: 'cta', p: '/', n: '/app/' }, { k: 'choice', p: '/', n: 'edition', v: 'ca-firm' }, { k: 'pv', p: '/dpdp-firm/' }, { k: 'exit', p: '/dpdp-firm/', n: 'pricing', ms: 41000, sc: 80 }] })
    expect(r.events).toBe(5)
    const s = await one<any>(`select * from dpdp.visit_session where id = $1`, [sid(1)])
    expect(s).toMatchObject({ exit_path: '/dpdp-firm/', exit_section: 'pricing', exit_ms: 41000, exit_scroll: 80, events_n: 6 })
  })
  test('the same visitor id again in a NEW session is visit number 2; a different visitor starts at 1', async () => {
    expect((await ingest({ sid: sid(2) })).visit_no).toBe(2)
    expect((await ingest({ sid: sid(3), vid: VID2, ip_hash: hash(2) })).visit_no).toBe(1)
  })
  test('with no visitor id the SAME keyed ip hash is recognised as a return; a different one is not', async () => {
    expect((await ingest({ sid: sid(4), vid: null, ip_hash: hash(7) })).visit_no).toBe(1)
    expect((await ingest({ sid: sid(5), vid: null, ip_hash: hash(7) })).visit_no).toBe(2)
    expect((await ingest({ sid: sid(6), vid: null, ip_hash: hash(8) })).visit_no).toBe(1)
  })
  test('a bot is kept apart: only its page views are stored, and it does not count as a returning human', async () => {
    const r = await ingest({ sid: sid(9), vid: null, ip_hash: hash(9), is_bot: true, bot_name: 'Googlebot', events: [{ k: 'pv', p: '/' }, { k: 'sec', p: '/', n: 'how', ms: 5000 }, { k: 'cta', n: '/app/' }] })
    expect(r.events).toBe(1)
    expect((await one<any>(`select is_bot, bot_name from dpdp.visit_session where id = $1`, [sid(9)]))).toMatchObject({ is_bot: true, bot_name: 'Googlebot' })
    expect((await ingest({ sid: sid(10), vid: null, ip_hash: hash(9) })).visit_no).toBe(1)
  })
  test('a session id belonging to another visitor is refused (nothing is written to it)', async () => {
    const before = (await one<any>(`select events_n from dpdp.visit_session where id = $1`, [sid(3)])).events_n
    const r = await ingest({ sid: sid(3), vid: VID3 })
    expect(r).toMatchObject({ ok: false, reason: 'sid' })
    expect((await one<any>(`select events_n from dpdp.visit_session where id = $1`, [sid(3)])).events_n).toBe(before)
  })
  test('unknown event kinds are dropped, durations are capped, and a session holds at most 400 events', async () => {
    const r = await ingest({ sid: sid(11), vid: VID4, ip_hash: hash(4), events: [{ k: 'evil', p: '/' }, { k: 'sec', p: '/', n: 'x', ms: 999999999 }] })
    expect(r.events).toBe(1)
    expect((await one<any>(`select ms from dpdp.visit_event where session_id = $1`, [sid(11)])).ms).toBe(86400000)
    for (let i = 0; i < 14; i++) await ingest({ sid: sid(11), vid: VID4, ip_hash: hash(4), limit: 10000, events: Array.from({ length: 30 }, () => ({ k: 'pv', p: '/' })) })
    expect((await one<any>(`select events_n from dpdp.visit_session where id = $1`, [sid(11)])).events_n).toBe(400)
  })
  test('the rate limit refuses a visitor over the per-minute budget and writes nothing for the refused batch', async () => {
    await ingest({ sid: sid(12), vid: VID5, ip_hash: hash(5), limit: 5, events: [{ k: 'pv', p: '/' }] })
    const r = await ingest({ sid: sid(12), vid: VID5, ip_hash: hash(5), limit: 5, events: Array.from({ length: 10 }, () => ({ k: 'pv', p: '/' })) })
    expect(r).toMatchObject({ ok: false, reason: 'rate' })
    expect((await one<any>(`select events_n from dpdp.visit_session where id = $1`, [sid(12)])).events_n).toBe(1)
  })
  test('a request with no session id is a caller mistake', async () => {
    await expect(rpc('dpdp_visit_ingest', { vid: VID1, events: [] })).rejects.toThrow(/sid is required/)
  })
})

describe('the privacy signal: count only', () => {
  test('writes no session, no event, no address, no hash; bumps the daily counters', async () => {
    const before = await one<any>(`select (select count(*) from dpdp.visit_session) s, (select count(*) from dpdp.visit_event) e`)
    await rpc('dpdp_visit_count_only', { path: '/dpdp-firm/', country: 'IN', is_bot: false })
    await rpc('dpdp_visit_count_only', { path: '/dpdp-firm/', country: 'IN', is_bot: false })
    const after = await one<any>(`select (select count(*) from dpdp.visit_session) s, (select count(*) from dpdp.visit_event) e`)
    expect(after).toEqual(before)
    expect(Number((await one<any>(`select n from dpdp.visit_agg where dimension = 'off_pv' and key = '/dpdp-firm/' and human`)).n)).toBe(2)
    expect(Number((await one<any>(`select n from dpdp.visit_agg where dimension = 'off_country' and key = 'IN'`)).n)).toBe(2)
  })
  test('its own global bucket limits abuse', async () => {
    const r = await rpc('dpdp_visit_count_only', { path: '/', limit: 1 })
    expect(r.ok).toBe(false)
  })
})

describe('linking a visitor to a person', () => {
  test('only a visitor with sessions on record can be linked; the identity is found from the e-mail without storing it', async () => {
    expect(await rpc('dpdp_visit_link', 'f0'.repeat(12), 'auth-x', 'founder@acme.in')).toEqual({ linked: false })
    expect(await rpc('dpdp_visit_link', 'not-hex', 'auth-x', 'founder@acme.in')).toEqual({ linked: false })
    expect(await rpc('dpdp_visit_link', VID1, 'auth-1', 'founder@acme.in')).toEqual({ linked: true, identity: true })
    const l = await one<any>(`select * from dpdp.visit_link where visitor_id = $1`, [VID1])
    expect(l.identity_id).toBe('i1')
    expect(JSON.stringify(l)).not.toContain('acme')
  })
  test('a person with no identity yet is linked without one, and a later call completes it', async () => {
    expect(await rpc('dpdp_visit_link', VID4, 'auth-4', 'late@gamma.in')).toEqual({ linked: true, identity: true })
    expect(await rpc('dpdp_visit_link', VID2, 'auth-2', 'nobody@nowhere.in')).toEqual({ linked: true, identity: false })
    expect((await one<any>(`select identity_id from dpdp.visit_link where visitor_id = $1`, [VID2])).identity_id).toBeNull()
    await rpc('dpdp_visit_link', VID2, 'auth-2', 'buyer@beta.in')
    expect((await one<any>(`select identity_id from dpdp.visit_link where visitor_id = $1`, [VID2])).identity_id).toBe('i2')
  })
})

describe('the funnel and the owner report', () => {
  beforeAll(async () => {
    // i1 (VID1, first touch: search/Google): organisation, wizard, a confirmed payment AFTER the first visit.
    await db.exec(`
      insert into dpdp.event (org_id, actor_identity_id, kind) values ('o1', 'i1', 'organisation_created');
      insert into dpdp.membership (id, identity_id, org_id, level, state, first_visit_seen_at) values ('m1', 'i1', 'o1', 'owner', 'active', (now() at time zone 'UTC'));
      insert into dpdp.event (org_id, actor_identity_id, kind) values ('o1', null, 'payment_confirmed');
      -- i2 (VID2): organisation created, wizard NOT done, a payment from BEFORE the first visit (must not count).
      insert into dpdp.event (org_id, actor_identity_id, kind) values ('o2', 'i2', 'organisation_created');
      insert into dpdp.membership (id, identity_id, org_id, level, state) values ('m2', 'i2', 'o2', 'owner', 'active');
      insert into dpdp.event (org_id, actor_identity_id, kind, occurred_at) values ('o2', null, 'payment_confirmed', (now() at time zone 'UTC') - interval '30 days');
    `)
  })
  const funnel = async () => (await rpc('dpdp_visit_report', 30)).funnel_by_source as Array<Record<string, any>>
  const total = (rows: Array<Record<string, any>>, k: string) => rows.reduce((a, r) => a + Number(r[k]), 0)

  test('stages nest, are counted per visitor by first-touch source, and bots never enter', async () => {
    const rows = await funnel()
    // humans with a visitor id or an ip hash: VID1 (search), VID2 (search), VID4 (search), VID5 (search), and the no-vid ones (hash 7, hash 8): each a visitor
    const search = rows.find((r) => r.source_kind === 'search' && r.source_detail === 'Google')!
    expect(search).toBeTruthy()
    expect(Number(search.paid)).toBe(1)          // only VID1 (i1) paid after their first visit
    expect(Number(search.wizard_done)).toBe(1)   // only i1 finished the wizard
    expect(Number(search.org_created)).toBe(2)   // i1 and i2 created organisations
    expect(Number(search.signed_up)).toBe(3)     // VID1, VID2, VID4 are linked
    expect(Number(search.cta)).toBeGreaterThanOrEqual(3)
    expect(Number(search.key_page)).toBeGreaterThanOrEqual(Number(search.cta))
    expect(Number(search.visits)).toBeGreaterThanOrEqual(Number(search.key_page))
    for (const r of rows) { const a = ['visits', 'key_page', 'cta', 'signed_up', 'org_created', 'wizard_done', 'paid'].map((k) => Number(r[k])); for (let i = 1; i < a.length; i++) expect(a[i]).toBeLessThanOrEqual(a[i - 1]!) }
    expect(total(rows, 'visits')).toBe(8)       // 4 visitor ids + 4 id-less sessions (each its own visitor); the bot is excluded
  })
  test('the report: sources, landing pages, sections with dwell, exits, calls to action, choices, places, returning ip hashes, bots', async () => {
    const r = await rpc('dpdp_visit_report', 30)
    expect(r.totals.bot_sessions).toBe(1)
    expect(r.totals.returning_visitors).toBe(1)
    expect(r.totals.returning_sessions).toBe(2)
    expect(r.sources[0]).toMatchObject({ kind: 'search', detail: 'Google' })
    expect(r.landing_pages[0].path).toBe('/')
    expect(r.sections).toContainEqual(expect.objectContaining({ path: '/', section: 'how', views: expect.any(Number), avg_dwell_ms: expect.any(Number) }))
    expect(r.exits).toContainEqual(expect.objectContaining({ path: '/dpdp-firm/', section: 'pricing', avg_ms: 41000, avg_scroll: 80 }))
    expect(r.ctas).toContainEqual(expect.objectContaining({ cta: '/app/' }))
    expect(r.choices).toContainEqual({ choice: 'edition', value: 'ca-firm', count: 1 })
    expect(r.places).toContainEqual(expect.objectContaining({ country: 'IN', city: 'Pune' }))
    expect(r.bots).toEqual([{ bot: 'Googlebot', sessions: 1 }])
    expect(r.count_only_visits).toBe(2)
    expect(r.returning_ip_hashes.length).toBeGreaterThan(0)
    for (const h of r.returning_ip_hashes) expect(String(h.ip_hash).length).toBe(12)
    expect(JSON.stringify(r)).not.toContain('founder@')
  })
  test("one visitor's journey from the first visit, by visitor id or by identity id; bots are not in it", async () => {
    const byVid = await rpc('dpdp_visit_journey', VID1, null)
    expect(byVid.sessions.length).toBe(2)
    expect(byVid.sessions[0].started_at <= byVid.sessions[1].started_at).toBe(true)
    expect(byVid.sessions[0].events.map((e: any) => e.kind)).toContain('exit')
    expect(byVid.linked_identities).toEqual(['i1'])
    const byIdentity = await rpc('dpdp_visit_journey', null, 'i1')
    expect(byIdentity.sessions.length).toBe(2)
    expect((await rpc('dpdp_visit_journey', 'f0'.repeat(12), null)).sessions).toEqual([])
  })
})

describe('retention: 365 days', () => {
  test('aggregates are written first, raw rows and links go, recent rows stay, a second run adds nothing, and the aggregates hold no identifier', async () => {
    // Age everything of VID1 (two sessions) and the bot session by 400 days; VID2.. stay recent.
    await db.query(`update dpdp.visit_session set started_at = started_at - interval '400 days', last_seen_at = last_seen_at - interval '400 days' where visitor_id = $1 or id = $2`, [VID1, sid(9)])
    const before = await one<any>(`select (select count(*) from dpdp.visit_session) s, (select count(*) from dpdp.visit_link) l`)
    const out = await rpc('dpdp_visit_retention', 365)
    expect(out.sessions_deleted).toBe(3)
    const after = await one<any>(`select (select count(*) from dpdp.visit_session) s, (select count(*) from dpdp.visit_link) l`)
    expect(Number(after.s)).toBe(Number(before.s) - 3)
    expect(Number(after.l)).toBe(Number(before.l) - 1) // VID1's link only
    expect((await q(`select 1 from dpdp.visit_event e where not exists (select 1 from dpdp.visit_session s where s.id = e.session_id)`)).length).toBe(0)
    expect((await q(`select 1 from dpdp.visit_session where visitor_id = $1`, [VID1])).length).toBe(0)
    expect((await q(`select 1 from dpdp.visit_session where visitor_id = $1`, [VID2])).length).toBe(1)
    const agg = await q<any>(`select dimension, key, human, n from dpdp.visit_agg where day < (now() at time zone 'UTC')::date - 300 order by dimension, key`)
    expect(Number(agg.find((a) => a.dimension === 'sessions' && a.key === 'search' && a.human)!.n)).toBe(2)
    expect(agg.find((a) => a.dimension === 'sessions' && a.key === 'direct' && !a.human) || agg.find((a) => a.dimension === 'sessions' && !a.human)).toBeTruthy()
    expect(agg.find((a) => a.dimension === 'section' && a.key === '/#how')).toBeTruthy()
    expect(agg.find((a) => a.dimension === 'choice' && a.key === 'edition=ca-firm')).toBeTruthy()
    expect(agg.find((a) => a.dimension === 'cta' && a.key === '/app/')).toBeTruthy()
    const funnel = await q<any>(`select dimension, n from dpdp.visit_agg where dimension like 'funnel_%' and key = 'search'`)
    expect(Number(funnel.find((f) => f.dimension === 'funnel_paid')!.n)).toBe(1)
    const blob = JSON.stringify(await q(`select * from dpdp.visit_agg`))
    for (const secret of [VID1, VID2, hash(1), '203.0.113', 'i1', 'founder']) expect(blob).not.toContain(secret)
    const aggCount = (await one<any>(`select count(*) c, sum(n) n from dpdp.visit_agg`))
    const again = await rpc('dpdp_visit_retention', 365)
    expect(again.sessions_deleted).toBe(0)
    expect(await one<any>(`select count(*) c, sum(n) n from dpdp.visit_agg`)).toEqual(aggCount)
  })
  test('the minimum is 30 days: a short argument cannot wipe recent data', async () => {
    const before = (await one<any>(`select count(*) c from dpdp.visit_session`)).c
    await rpc('dpdp_visit_retention', 1)
    expect((await one<any>(`select count(*) c from dpdp.visit_session`)).c).toBe(before)
  })
})

describe('who can touch it', () => {
  test('no browser-facing role can read the tables or call the functions; service_role can call them', async () => {
    for (const role of ['anon', 'authenticated', 'app_runtime']) {
      await db.exec(`set role ${role}`)
      await expect(db.query(`select * from dpdp.visit_session`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select * from dpdp.visit_link`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select public.dpdp_visit_report(7)`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select public.dpdp_visit_journey('x', null)`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select public.dpdp_visit_retention(365)`)).rejects.toThrow(/permission denied/)
      await db.exec(`reset role`)
    }
    await db.exec(`set role service_role`)
    expect((await db.query(`select public.dpdp_visit_report(7) as r`)).rows.length).toBe(1)
    await db.exec(`reset role`)
  })
  test('row level security is on for every table', async () => {
    const t = await q<any>(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and relname like 'visit_%' and relkind = 'r'`)
    expect(t.length).toBe(5)
    for (const r of t) expect(r.relrowsecurity).toBe(true)
  })
})
