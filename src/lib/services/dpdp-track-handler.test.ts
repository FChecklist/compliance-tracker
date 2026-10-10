/// <reference types="bun-types" />
// The dpdp-track Edge Function's routes (supabase/functions/dpdp-track/handler.ts) against a fake database and a fake sign-in: the beacon (origin check, size and shape limits,
// what is passed on, what is NOT: raw ip, forged headers), the privacy signal (count only, enforced from the request header too), bots, rate-limit answers, linking a signed-in
// person by identity id, and the OWNER-ONLY reads (report and journey) with the access-log row written first.
//
// Run: bun test --isolate src/lib/services/dpdp-track-handler.test.ts
import { describe, expect, test } from 'bun:test'
import { handle, networkFacts, type Deps, type Rpc } from '../../../supabase/functions/dpdp-track/handler'

const KEY = 'visit-key-'.repeat(4)
const PROXY = 'proxy-key-'.repeat(3)
type Call = { fn: string; args: Record<string, any> }

function harness(opts: { owner?: boolean; jwtOk?: boolean; email?: string; rpcFor?: Record<string, { data?: unknown; error?: { code?: string; message: string } }>; env?: Record<string, string> } = {}) {
  const calls: Call[] = []
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args })
    const o = opts.rpcFor?.[fn]
    if (o) return { data: o.data ?? null, error: o.error ?? null }
    if (fn === 'dpdp_audit_resolve_caller') return { data: { identityId: 'i1', memberships: [], isPlatformOwner: opts.owner === true }, error: null }
    if (fn === 'dpdp_audit_staff_begin') return { data: 'log-1', error: null }
    if (fn === 'dpdp_visit_ingest') return { data: { ok: true, visit_no: 1, events: 1 }, error: null }
    if (fn === 'dpdp_visit_report') return { data: { days: 30, totals: { human_visitors: 3, human_sessions: 4, returning_visitors: 1, bot_sessions: 2 }, count_only_visits: 1, funnel_by_source: [{ source_kind: 'search', source_detail: 'Google', visits: 10, key_page: 6, cta: 3, signed_up: 2, org_created: 1, wizard_done: 1, paid: 1 }] }, error: null }
    if (fn === 'dpdp_visit_journey') return { data: { visitor_ids: ['x'], sessions: [{ id: 's1' }, { id: 's2' }] }, error: null }
    if (fn === 'dpdp_visit_link') return { data: { linked: true, identity: true }, error: null }
    return { data: null, error: null }
  }
  const env: Record<string, string> = { DPDP_VISIT_KEY: KEY, DPDP_VISIT_PROXY_KEY: PROXY, ...(opts.env ?? {}) }
  const deps: Deps = { rpc, now: () => Date.parse('2026-10-06T10:00:00Z'), env: (n) => env[n] ?? '', verifyJwt: async (jwt) => (opts.jwtOk === false || jwt === 'bad' ? null : { email: opts.email ?? 'boss@veridian.test', claims: { sub: 'auth-user-1' } }) }
  return { deps, calls }
}
const beaconBody = (over: Record<string, unknown> = {}) => ({ sid: 'ab'.repeat(8), vid: 'cd'.repeat(12), p: '/dpdp-firm/', d: 'desktop', l: 'en-IN', r: 'www.google.com', e: [{ k: 'pv', p: '/dpdp-firm/' }], ...over })
const post = (body: unknown, headers: Record<string, string> = {}, path = '') => new Request(`https://x.supabase.co/functions/v1/dpdp-track${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/124.0 Safari/537.36', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://x.supabase.co/functions/v1/dpdp-track${path}`, { headers: { authorization: 'Bearer good-token', ...headers } })
const ingested = (calls: Call[]) => calls.find((c) => c.fn === 'dpdp_visit_ingest')?.args.p

describe('the beacon', () => {
  test('a good beacon is stored with a SHORTENED ip and a keyed hash, never the raw address; the page learns nothing (204)', async () => {
    const h = harness()
    const res = await handle(post(beaconBody(), { 'x-forwarded-for': '203.0.113.77', 'cf-ipcountry': 'IN', origin: 'https://veridian-aios.com' }), h.deps)
    expect(res.status).toBe(204)
    const p = ingested(h.calls)
    expect(p).toMatchObject({ sid: 'ab'.repeat(8), vid: 'cd'.repeat(12), ip_short: '203.0.113.0', source_kind: 'search', search_engine: 'Google', landing_path: '/dpdp-firm/', device: 'desktop', country: 'IN', is_bot: false })
    expect(p.ip_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(h.calls)).not.toContain('203.0.113.77')
  })
  test('the same address gives the same hash on a later beacon (a returning IP is recognised without storing it)', async () => {
    const a = harness(); const b = harness()
    await handle(post(beaconBody(), { 'x-forwarded-for': '203.0.113.77' }), a.deps)
    await handle(post(beaconBody({ sid: 'ef'.repeat(8) }), { 'x-forwarded-for': '203.0.113.77' }), b.deps)
    expect(ingested(a.calls).ip_hash).toBe(ingested(b.calls).ip_hash)
  })
  test('without DPDP_VISIT_KEY no hash is stored at all (never an unkeyed one); the shortened ip still is', async () => {
    const h = harness({ env: { DPDP_VISIT_KEY: '' } })
    await handle(post(beaconBody(), { 'x-forwarded-for': '203.0.113.77' }), h.deps)
    expect(ingested(h.calls)).toMatchObject({ ip_hash: null, ip_short: '203.0.113.0' })
  })
  test('a beacon from another origin is dropped silently, with nothing written', async () => {
    const h = harness()
    const res = await handle(post(beaconBody(), { origin: 'https://evil.example' }), h.deps)
    expect(res.status).toBe(204)
    expect(h.calls.length).toBe(0)
  })
  test('too large is 413, malformed is 400, and neither reaches the database', async () => {
    const h = harness()
    expect((await handle(post(beaconBody({ e: [{ k: 'pv', p: '/', pad: 'x'.repeat(7000) }] })), h.deps)).status).toBe(413)
    expect((await handle(post('not json'), h.deps)).status).toBe(400)
    expect((await handle(post(beaconBody({ p: '/app/' })), h.deps)).status).toBe(400)
    expect(h.calls.length).toBe(0)
  })
  test('events carrying personal-looking values never reach the database', async () => {
    const h = harness()
    await handle(post(beaconBody({ e: [{ k: 'cta', n: 'priya@acme.in' }, { k: 'choice', n: 'name', v: 'Priya Shah' }, { k: 'sec', p: '/', n: 'how', ms: 9000 }] })), h.deps)
    expect(ingested(h.calls).events).toEqual([{ k: 'sec', p: '/', n: 'how', v: null, ms: 9000, sc: null }])
    expect(JSON.stringify(h.calls)).not.toContain('priya')
  })
  test('the database refusing for rate is answered 429; a database error is swallowed (204) so the page is never affected', async () => {
    expect((await handle(post(beaconBody()), harness({ rpcFor: { dpdp_visit_ingest: { data: { ok: false, reason: 'rate' } } } }).deps)).status).toBe(429)
    expect((await handle(post(beaconBody()), harness({ rpcFor: { dpdp_visit_ingest: { error: { message: 'boom' } } } }).deps)).status).toBe(204)
  })
  test('the rate limit passed to the database is bounded whatever the env says', async () => {
    const lo = harness({ env: { DPDP_VISIT_RATE_PER_MIN: '1' } }); const hi = harness({ env: { DPDP_VISIT_RATE_PER_MIN: '999999' } })
    await handle(post(beaconBody()), lo.deps); await handle(post(beaconBody()), hi.deps)
    expect(ingested(lo.calls).limit).toBe(10); expect(ingested(hi.calls).limit).toBe(600)
  })
  test('a crawler is stored as a bot, with no visitor id', async () => {
    const h = harness()
    await handle(post(beaconBody(), { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }), h.deps)
    expect(ingested(h.calls)).toMatchObject({ is_bot: true, bot_name: 'Googlebot', vid: null })
  })
})

describe('Global Privacy Control / Do Not Track', () => {
  test('an "off" beacon only counts: no session, no visitor id, no ip, no hash', async () => {
    const h = harness()
    const res = await handle(post({ off: 1, p: '/dpdp-firm/', d: 'desktop', vid: 'cd'.repeat(12), sid: 'ab'.repeat(8) }, { 'x-forwarded-for': '203.0.113.77', 'cf-ipcountry': 'IN' }), h.deps)
    expect(res.status).toBe(204)
    expect(h.calls.map((c) => c.fn)).toEqual(['dpdp_visit_count_only'])
    expect(JSON.stringify(h.calls)).not.toMatch(/203\.0\.113|cdcdcd|abab|ip_hash|ip_short/)
    expect(h.calls[0]!.args.p).toMatchObject({ path: '/dpdp-firm/', country: 'IN', is_bot: false })
  })
  test('the browser\'s own header wins over the body: Sec-GPC or DNT on a full beacon is still only counted', async () => {
    for (const header of [{ 'sec-gpc': '1' }, { dnt: '1' }] as Array<Record<string, string>>) {
      const h = harness()
      await handle(post(beaconBody(), { ...header, 'x-forwarded-for': '203.0.113.77' }), h.deps)
      expect(h.calls.map((c) => c.fn)).toEqual(['dpdp_visit_count_only'])
      expect(JSON.stringify(h.calls)).not.toContain('cdcdcd')
    }
  })
})

describe('where the visitor was: only from a request that proves it came through our relay', () => {
  const mk = (headers: Record<string, string>) => new Request('https://x/', { headers })
  test('with the proxy key the forwarded address, country and city are used', () => {
    const n = networkFacts(mk({ 'x-dpdp-proxy-key': PROXY, 'x-dpdp-client-ip': '198.51.100.20', 'x-dpdp-client-country': 'in', 'x-dpdp-client-city': encodeURIComponent('Pune'), 'x-forwarded-for': '10.0.0.1', 'user-agent': 'UA' }), PROXY)
    expect(n).toEqual({ ip: '198.51.100.20', country: 'IN', city: 'Pune', userAgent: 'UA' })
  })
  test('a browser calling the function directly cannot choose them: forged x-dpdp-* headers are ignored', () => {
    const n = networkFacts(mk({ 'x-dpdp-client-ip': '198.51.100.20', 'x-dpdp-client-country': 'US', 'x-dpdp-client-city': 'Atlantis', 'x-forwarded-for': '203.0.113.5', 'cf-ipcountry': 'IN' }), PROXY)
    expect(n).toMatchObject({ ip: '203.0.113.5', country: 'IN', city: null })
  })
  test('a wrong proxy key is no key; no configured key means nothing forwarded is trusted', () => {
    expect(networkFacts(mk({ 'x-dpdp-proxy-key': 'wrong'.repeat(5), 'x-dpdp-client-ip': '198.51.100.20', 'x-forwarded-for': '203.0.113.5' }), PROXY).ip).toBe('203.0.113.5')
    expect(networkFacts(mk({ 'x-dpdp-proxy-key': '', 'x-dpdp-client-ip': '198.51.100.20', 'x-forwarded-for': '203.0.113.5' }), '').ip).toBe('203.0.113.5')
  })
  test('unknown countries (XX, T1) and junk in the city are cleaned', () => {
    expect(networkFacts(mk({ 'cf-ipcountry': 'XX' }), PROXY).country).toBeNull()
    expect(networkFacts(mk({ 'cf-ipcountry': 'T1' }), PROXY).country).toBeNull()
    expect(networkFacts(mk({ 'x-dpdp-proxy-key': PROXY, 'x-dpdp-client-city': encodeURIComponent('<b>Pune</b>; drop table') }), PROXY).city).toBe('bPuneb drop table')
  })
})

describe('/link: a signed-in person is linked to their visitor id, by identity id, server-side', () => {
  const vid = 'cd'.repeat(12)
  test('needs a sign-in', async () => {
    const h = harness()
    expect((await handle(post({ vid }, {}, '/link'), h.deps)).status).toBe(401)
    expect((await handle(post({ vid }, { authorization: 'Bearer bad' }, '/link'), h.deps)).status).toBe(401)
    expect(h.calls.length).toBe(0)
  })
  test('passes the verified account id and e-mail to the database (which stores neither the e-mail nor a name)', async () => {
    const h = harness()
    const res = await handle(post({ vid }, { authorization: 'Bearer good' }, '/link'), h.deps)
    expect(await res.json()).toEqual({ linked: true, identity: true })
    expect(h.calls[0]).toEqual({ fn: 'dpdp_visit_link', args: { p_visitor_id: vid, p_auth_user_id: 'auth-user-1', p_email: 'boss@veridian.test' } })
  })
  test('a visitor id that is not hex is not even sent to the database', async () => {
    const h = harness()
    expect(await (await handle(post({ vid: 'priya@acme.in' }, { authorization: 'Bearer good' }, '/link'), h.deps)).json()).toEqual({ linked: false })
    expect(h.calls.length).toBe(0)
  })
})

describe('owner-only reads', () => {
  test('no sign-in: 401. Signed in but not the platform owner: 403, and the access log is NOT written and no data is read', async () => {
    const h = harness({ owner: false })
    expect((await handle(new Request('https://x/functions/v1/dpdp-track/report'), h.deps)).status).toBe(401)
    expect((await handle(get('/report'), h.deps)).status).toBe(403)
    expect((await handle(get('/journey?vid=' + 'cd'.repeat(12)), h.deps)).status).toBe(403)
    expect(h.calls.map((c) => c.fn).filter((f) => f !== 'dpdp_audit_resolve_caller')).toEqual([])
  })
  test('the owner: the access-log row is written FIRST, then the report is read, then the log is completed', async () => {
    const h = harness({ owner: true })
    const res = await handle(get('/report?days=7'), h.deps)
    expect(res.status).toBe(200)
    const order = h.calls.map((c) => c.fn)
    expect(order).toEqual(['dpdp_audit_resolve_caller', 'dpdp_audit_staff_begin', 'dpdp_visit_report', 'dpdp_audit_staff_finish'])
    expect(h.calls[1]!.args).toMatchObject({ p_email: 'boss@veridian.test', p_org: '*visits', p_scope: 'visit_report', p_filters: { days: 7 } })
    expect(String(h.calls[1]!.args.p_reason).length).toBeGreaterThanOrEqual(10)
    expect(h.calls[2]!.args).toEqual({ p_days: 7 })
    const body = await res.json() as { accessLogId: string; report: Record<string, unknown> }
    expect(body.accessLogId).toBe('log-1'); expect(body.report.days).toBe(30)
    expect(res.headers.get('cache-control')).toBe('no-store'); expect(res.headers.get('x-robots-tag')).toContain('noindex')
  })
  test('if the access-log row cannot be written, nothing is served', async () => {
    const h = harness({ owner: true, rpcFor: { dpdp_audit_staff_begin: { error: { code: '42501', message: 'Only the platform owner' } } } })
    expect((await handle(get('/report'), h.deps)).status).toBe(403)
    expect(h.calls.some((c) => c.fn === 'dpdp_visit_report')).toBe(false)
  })
  test('the report as Markdown (the funnel, converted by source)', async () => {
    const h = harness({ owner: true })
    const res = await handle(get('/report?format=md'), h.deps)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const md = await res.text()
    expect(md).toContain('## Funnel'); expect(md).toContain('## Converted by source (first visit)'); expect(md).toContain('| search: Google | 10 | 2 | 1 |')
  })
  test('days is clamped to 1..365', async () => {
    const h = harness({ owner: true })
    await handle(get('/report?days=100000'), h.deps)
    expect(h.calls.find((c) => c.fn === 'dpdp_visit_report')!.args.p_days).toBe(365)
  })
  test('the journey needs a visitor id or an identity id, is logged first, and counts the sessions it returned', async () => {
    const h = harness({ owner: true })
    expect((await handle(get('/journey'), h.deps)).status).toBe(400)
    expect((await handle(get('/journey?vid=not-hex'), h.deps)).status).toBe(400)
    const res = await handle(get('/journey?identity=i1abcdef12&reason=' + encodeURIComponent('Follow-up on the October demo request')), h.deps)
    expect(res.status).toBe(200)
    const begin = h.calls.find((c) => c.fn === 'dpdp_audit_staff_begin')!
    expect(begin.args).toMatchObject({ p_scope: 'visit_journey', p_reason: 'Follow-up on the October demo request', p_filters: { identity: 'i1abcdef12' } })
    expect(h.calls.find((c) => c.fn === 'dpdp_visit_journey')!.args).toEqual({ p_visitor_id: null, p_identity_id: 'i1abcdef12' })
    expect(h.calls.find((c) => c.fn === 'dpdp_audit_staff_finish')!.args).toEqual({ p_log_id: 'log-1', p_rows: 2 })
  })
  test('unknown routes and wrong methods are 404', async () => {
    const h = harness({ owner: true })
    expect((await handle(get('/nope'), h.deps)).status).toBe(404)
    expect((await handle(new Request('https://x/functions/v1/dpdp-track/report', { method: 'POST' }), h.deps)).status).toBe(404)
  })
})
