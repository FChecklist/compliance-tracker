// The dpdp-audit Edge Function's routes (supabase/functions/dpdp-audit/handler.ts) against a fake database that computes the REAL chain: who may download what, the fresh-code
// and rate-limit rules, masking in the file the browser receives, the verification hash, "verify chain" (including removal of the newest rows), the failed-login ingestion
// rules, and the internal staff read (access log first, reason required).
//
// Run: bun test --isolate src/lib/services/dpdp-audit-handler.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { BROWSER_EVENTS, MAX_VERIFY_ROWS, corsHeaders, freshCodeOk, handle, lastCodeSignInSeconds, type Deps } from '../../../supabase/functions/dpdp-audit/handler'
import { generateKeyB64, keyRingFrom, type KeyRing } from '../../../supabase/functions/_shared/audit/seal'
import { makeWriter } from '../../../supabase/functions/_shared/audit/writer'
import { fileIsIntact } from '../../../supabase/functions/_shared/audit/download'
import { FakeAuditDb, type Person } from './__test-helpers__/audit-fake-db'

const NOW = Date.parse('2026-10-06T10:00:00Z')
const BASE = 'https://x.supabase.co/functions/v1/dpdp-audit'
let ring: KeyRing
let db: FakeAuditDb
let people: Person[]
let clock = NOW
let tokens: Record<string, { email: string; claims: Record<string, unknown> }>

const codeClaims = (ageSeconds: number, method = 'otp') => ({ amr: [{ method, timestamp: Math.floor(NOW / 1000) - ageSeconds }], session_id: 'sess-1' })
const mk = (env: Record<string, string> = {}): Deps => ({
  rpc: db.rpc, ring: async () => ring, now: () => clock, env: (n) => env[n] ?? '',
  verifyJwt: async (jwt) => tokens[jwt] ?? null,
})
const call = (path: string, init: RequestInit & { token?: string; env?: Record<string, string> } = {}) => {
  const { token, env, headers, ...rest } = init
  return handle(new Request(`${BASE}${path}`, { ...rest, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers as Record<string, string>) } }), mk(env))
}
const post = (path: string, body: unknown, token?: string, headers: Record<string, string> = {}) => call(path, { method: 'POST', body: JSON.stringify(body), token, headers: { 'content-type': 'application/json', ...headers } })

/** Seed a chain row the way the app would. */
async function seed(org: string, user: string, type: string, extra: Record<string, unknown> = {}) {
  const w = makeWriter(db.rpc, async () => ring, () => NOW)
  return w.append({ orgId: org, eventType: type as never, actorType: 'human', actorUserId: user, actorRole: 'owner', actorEmail: 'priya.shah@acme.in', net: { ip: '203.0.113.45', userAgent: 'Chrome/126 Windows NT 10.0', deviceId: 'DEV-8f3a91c2' }, ...(extra as object) })
}

beforeEach(async () => {
  ring = await keyRingFrom((n) => (n === 'DPDP_AUDIT_SEAL_KEY' ? generateKeyB64() : undefined))
  clock = NOW
  people = [
    { identityId: 'i1', email: 'priya.shah@acme.in', memberships: [{ orgId: 'o1', orgName: 'Acme', level: 'owner', hod: false }] },
    { identityId: 'i2', email: 'staff.person@acme.in', memberships: [{ orgId: 'o1', orgName: 'Acme', level: 'staff', hod: false }] },
    { identityId: 'i3', email: 'head.dept@acme.in', memberships: [{ orgId: 'o1', orgName: 'Acme', level: 'staff', hod: true }] },
    { identityId: 'i9', email: 'boss@veridian.test', memberships: [], isPlatformOwner: true },
  ]
  db = new FakeAuditDb(people)
  tokens = {
    owner: { email: 'priya.shah@acme.in', claims: codeClaims(60) },
    staff: { email: 'staff.person@acme.in', claims: codeClaims(60) },
    hod: { email: 'head.dept@acme.in', claims: codeClaims(60) },
    boss: { email: 'boss@veridian.test', claims: codeClaims(60) },
    stale: { email: 'priya.shah@acme.in', claims: codeClaims(3600) },
    nocode: { email: 'priya.shah@acme.in', claims: { amr: [{ method: 'password', timestamp: Math.floor(NOW / 1000) - 5 }] } },
  }
  await seed('o1', 'i1', 'login'); await seed('o1', 'i2', 'edit', { actorEmail: 'staff.person@acme.in', actorRole: 'staff' }); await seed('o1', 'i1', 'create'); await seed('o1', 'i2', 'delete', { actorRole: 'staff', actorEmail: 'staff.person@acme.in' })
})

describe('the fresh-code rule (reusing the e-mailed code the app already uses)', () => {
  test('newest code-based sign-in in amr within the window; password, none, old, or from the future do not count', () => {
    expect(lastCodeSignInSeconds(codeClaims(10))).toBe(Math.floor(NOW / 1000) - 10)
    expect(lastCodeSignInSeconds({ amr: [{ method: 'password', timestamp: 5 }, { method: 'otp', timestamp: 100 }, { method: 'magiclink', timestamp: 200 }] })).toBe(200)
    expect(lastCodeSignInSeconds({})).toBeNull()
    expect(freshCodeOk(codeClaims(599), NOW, 600)).toBe(true)
    expect(freshCodeOk(codeClaims(601), NOW, 600)).toBe(false)
    expect(freshCodeOk(codeClaims(-1000), NOW, 600)).toBe(false)
    expect(freshCodeOk({ amr: [{ method: 'password', timestamp: Math.floor(NOW / 1000) }] }, NOW, 600)).toBe(false)
    expect(freshCodeOk({ amr: 'x' }, NOW, 600)).toBe(false)
  })
})

describe('GET /my: a person downloads their own rows, masked', () => {
  test('signed-in + fresh code: an attachment with only their rows, every identifier masked, and a verification hash that matches the header and the issued-export record', async () => {
    const res = await call('/my', { token: 'staff' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.scope).toBe('own'); expect(body.row_count).toBe(2)
    expect(body.rows.every((r: { actor: { user_id: string } }) => r.actor.user_id === 'i2')).toBe(true)
    expect(body.prepared_for.email_masked).toBe('st***on@acme.in')
    for (const r of body.rows) { expect(r.actor.email).toBe('st***on@acme.in'); expect(r.net.ip).toBe('203***.45'); expect(r.net.device_id).toBe('DEV***1c2') }
    for (const full of ['staff.person', '203.0.113.45', 'DEV-8f3a91c2', 'aes1:']) expect(text).not.toContain(full)
    expect(res.headers.get('x-verification-hash')).toBe(body.verification_hash)
    expect(await fileIsIntact(body)).toBe(true)
    // it is recorded: one download_export row carrying the file's hash, so "did we issue this file?" has an answer
    const exp = db.rows.filter((r) => r.event_type === 'download_export')
    expect(exp).toHaveLength(1); expect(exp[0].ref_hash).toBe(body.verification_hash); expect(exp[0].actor_user_id).toBe('i2')
  })
  test('no bearer, a bad bearer, or a person with no organisation: refused', async () => {
    expect((await call('/my')).status).toBe(401)
    expect((await call('/my', { token: 'forged' })).status).toBe(401)
    people.push({ identityId: 'i7', email: 'loner@x.in', memberships: [] }); tokens.loner = { email: 'loner@x.in', claims: codeClaims(10) }
    expect((await call('/my', { token: 'loner' })).status).toBe(403)
  })
  test('no fresh code (older than 10 minutes, or never signed in with a code): refused with FRESH_CODE_REQUIRED, and the attempt is on the record as denied', async () => {
    for (const t of ['stale', 'nocode']) {
      const res = await call('/my', { token: t })
      expect(res.status).toBe(403); expect((await res.json()).code).toBe('FRESH_CODE_REQUIRED')
    }
    expect(db.rows.filter((r) => r.event_type === 'denied')).toHaveLength(2)
    expect(db.rows.filter((r) => r.event_type === 'download_export')).toHaveLength(0)
  })
  test('the window is configurable but bounded', async () => {
    tokens.mid = { email: 'priya.shah@acme.in', claims: codeClaims(900) }
    expect((await call('/my', { token: 'mid' })).status).toBe(403)
    expect((await call('/my', { token: 'mid', env: { DPDP_AUDIT_CODE_MAX_AGE_SECONDS: '1800' } })).status).toBe(200)
  })
  test('rate limit: the sixth download in an hour is refused (429) and itself logged; the limit is configurable', async () => {
    for (let i = 0; i < 5; i++) expect((await call('/my', { token: 'staff' })).status).toBe(200)
    const res = await call('/my', { token: 'staff' })
    expect(res.status).toBe(429); expect((await res.json()).code).toBe('RATE_LIMITED'); expect(res.headers.get('retry-after')).toBe('3600')
    expect(db.rows.filter((r) => r.event_type === 'download_export' && r.actor_user_id === 'i2')).toHaveLength(6)
    expect((await call('/my', { token: 'owner', env: { DPDP_AUDIT_EXPORTS_PER_HOUR: '1' } })).status).toBe(200)
    expect((await call('/my', { token: 'owner', env: { DPDP_AUDIT_EXPORTS_PER_HOUR: '1' } })).status).toBe(429)
  })
  test('fail closed: if the export cannot be recorded it is not handed out', async () => {
    const real = db.rpc
    db.rpc = async (fn, a) => (fn === 'dpdp_audit_append' && String(a.p_content).includes('"download_export"') ? { data: null, error: { message: 'down' } } : real(fn, a))
    const res = await call('/my', { token: 'staff' })
    expect(res.status).toBe(500); expect(await res.text()).not.toContain('"rows"')
  })
  test('nothing is e-mailed: the handler has no mail dependency at all, and the file is only ever the HTTP response', async () => {
    const d = mk(); expect(Object.keys(d).sort()).toEqual(['env', 'now', 'ring', 'rpc', 'verifyJwt'])
  })
})

describe('GET /org: the owner or a head of department downloads the whole log, masked', () => {
  test('an ordinary member is refused (and it is recorded); the owner and a named HOD get everyone\'s rows with the chain verified', async () => {
    const no = await call('/org', { token: 'staff' })
    expect(no.status).toBe(403); expect(db.rows.some((r) => r.event_type === 'denied' && r.actor_user_id === 'i2')).toBe(true)
    for (const t of ['owner', 'hod']) {
      const expected = db.rows.filter((r) => r.org_id === 'o1').length // everything on the chain at the moment of the request
      const res = await call('/org', { token: t })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.scope).toBe('organisation'); expect(body.row_count).toBe(expected)
      expect(body.chain.verified).toBe(true)
      expect(JSON.stringify(body)).not.toContain('priya.shah'); expect(JSON.stringify(body)).not.toContain('staff.person')
    }
  })
  test('the owner names a head of department; only an owner of that organisation can', async () => {
    expect((await post('/policy/hod', { org_id: 'o1', identity_ids: ['i2'] }, 'staff')).status).toBe(403)
    expect((await post('/policy/hod', { org_id: 'o1', identity_ids: ['i2'] }, 'owner')).status).toBe(200)
    expect((await call('/org', { token: 'staff' })).status).toBe(200)
    expect((await call('/org', { token: 'hod' })).status).toBe(403) // no longer named
  })
  test('a tampered row inside the file range shows chain.verified = false with where it broke', async () => {
    db.rows[1] = { ...db.rows[1], content_canonical: db.rows[1].content_canonical.replace('"edit"', '"create"') }
    const body = await (await call('/org', { token: 'owner' })).json()
    expect(body.chain.verified).toBe(false); expect(body.chain.detail).toContain('content_hash')
  })
  test('paging: limit and after_seq give a continuing stretch with more / next_after_seq', async () => {
    const first = await (await call('/org?limit=2', { token: 'owner' })).json()
    expect(first.row_count).toBe(2); expect(first.more).toBe(true)
    const second = await (await call(`/org?limit=100&after_seq=${first.next_after_seq}`, { token: 'owner' })).json()
    expect(second.rows[0].seq).toBe(first.next_after_seq + 1)
    expect(second.chain.verified).toBe(true)
  })
})

describe('POST /verify: verify chain', () => {
  test('a good chain is ok; an edited row, a removed middle row, and removal of the newest rows (a recorded daily head vanishes) are each reported', async () => {
    const good = await (await post('/verify', {}, 'owner')).json()
    expect(good).toMatchObject({ ok: true, rows: 4 })
    const last = db.rows[3]
    db.heads.push({ org: 'o1', head_date: '2026-10-05', head_hash: last.row_hash, last_seq: last.seq, row_count: 4 })
    expect(await (await post('/verify', {}, 'owner')).json()).toMatchObject({ ok: true, recordedHeadsChecked: 1 })
    const saved = [...db.rows]
    db.rows = db.rows.slice(0, 3) // the newest row is gone: every remaining link still holds
    expect(await (await post('/verify', {}, 'owner')).json()).toMatchObject({ ok: false, reason: 'recorded_head_missing' })
    db.rows = saved.filter((_, i) => i !== 1)
    expect(await (await post('/verify', {}, 'owner')).json()).toMatchObject({ ok: false, reason: 'link' })
    db.rows = saved.map((r, i) => (i === 2 ? { ...r, content_canonical: r.content_canonical.replace('"create"', '"delete"') } : r))
    expect(await (await post('/verify', {}, 'owner')).json()).toMatchObject({ ok: false, reason: 'content_hash', brokenAtSeq: saved[2].seq })
  })
  test('only the owner or a head of department; the answer after a purge starts at the anchor', async () => {
    expect((await post('/verify', {}, 'staff')).status).toBe(403)
    const anchorRow = db.rows[1]; db.anchor.o1 = { hash: anchorRow.row_hash, seq: anchorRow.seq }
    db.rows = db.rows.slice(2)
    expect(await (await post('/verify', {}, 'owner')).json()).toMatchObject({ ok: true, rows: 2 })
    expect(MAX_VERIFY_ROWS).toBeGreaterThan(10_000)
  })
})

describe('POST /verify-file', () => {
  test('an untouched file we issued is intact and issued by us; any edit makes it not intact; a file with a valid hash we never issued is intact but not issued', async () => {
    const text = await (await call('/my', { token: 'staff' })).text()
    const body = JSON.parse(text)
    expect(await (await post('/verify-file', body, 'staff')).json()).toMatchObject({ intact: true, issuedByUs: true })
    const edited = { ...body, rows: body.rows.slice(1) }
    expect(await (await post('/verify-file', edited, 'staff')).json()).toMatchObject({ intact: false, issuedByUs: false })
    const { fileVerificationHash } = await import('../../../supabase/functions/_shared/audit/chain')
    const forged: Record<string, unknown> = { a: 1 }; forged.verification_hash = await fileVerificationHash(forged)
    expect(await (await post('/verify-file', { file: forged }, 'staff')).json()).toMatchObject({ intact: true, issuedByUs: false })
  })
})

describe('POST /event: what a browser may report', () => {
  test('only login, failed_login and read_personal_data; a browser cannot claim a delete or an AI event', async () => {
    expect(BROWSER_EVENTS).toEqual(['login', 'failed_login', 'read_personal_data'])
    for (const type of ['delete', 'edit', 'ai_read', 'human_confirm', 'download_export', 'staff_read']) expect((await post('/event', { type }, 'owner')).status).toBe(400)
  })
  test('login: needs a sign-in; written with the method from amr, the session, the address the SERVER saw (not one in the body), client time and skew; values sealed', async () => {
    expect((await post('/event', { type: 'login' })).status).toBe(401)
    const before = db.rows.length
    const res = await post('/event', { type: 'login', device_id: 'DEV-abc12345', client_time: '2026-10-06T10:00:07Z', client_tz: 'Asia/Kolkata', ip: '6.6.6.6' }, 'owner', { 'cf-connecting-ip': '203.0.113.99', 'cf-ipcountry': 'in', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126' })
    expect(await res.json()).toMatchObject({ ok: true, recorded: true })
    const row = db.rows[before]; const c = JSON.parse(row.content_canonical)
    expect(row.event_type).toBe('login'); expect(c.login_method).toBe('otp'); expect(c.session_id).toBe('sess-1')
    expect(c.net).toMatchObject({ country: 'IN', browser: 'Chrome', os: 'Windows' }); expect(c.time).toMatchObject({ machine_time_zone: 'Asia/Kolkata', skew_ms: 7000 })
    expect(row.content_canonical).not.toContain('203.0.113.99'); expect(row.content_canonical).not.toContain('6.6.6.6'); expect(row.content_canonical).not.toContain('DEV-abc12345')
  })
  test('failed_login: same 202 for everyone (no account enumeration); only a KNOWN person is written; capped at 10 in 10 minutes', async () => {
    const r1 = await post('/event', { type: 'failed_login', email: 'nobody@nowhere.in' }); expect(r1.status).toBe(202)
    const n0 = db.rows.length
    for (let i = 0; i < 14; i++) expect((await post('/event', { type: 'failed_login', email: 'Staff.Person@acme.in' })).status).toBe(202)
    const failed = db.rows.slice(n0).filter((r) => r.event_type === 'failed_login')
    expect(failed).toHaveLength(10)
    expect(failed[0].actor_user_id).toBe('i2'); expect(failed[0].content_canonical).not.toContain('staff.person')
    expect((await post('/event', { type: 'failed_login' })).status).toBe(202)
    expect((await post('/event', { type: 'failed_login', email: 'not-an-email' })).status).toBe(202)
  })
  test('read_personal_data records the target; a login flood is limited', async () => {
    await post('/event', { type: 'read_personal_data', target_table: 'dpdp.consent_record', target_id: 'c1' }, 'staff')
    const r = db.rows.at(-1)!; expect(r.event_type).toBe('read_personal_data'); expect(JSON.parse(r.content_canonical).target).toEqual({ table: 'dpdp.consent_record', id: 'c1' })
    for (let i = 0; i < 30; i++) await post('/event', { type: 'login' }, 'staff')
    expect((await post('/event', { type: 'login' }, 'staff')).status).toBe(429)
  })
})

describe('internal staff access (item 3): owner only, reason required, access log written first', () => {
  test('not the platform owner: refused, nothing opened; owner without a reason: refused, no values, but the refusal leaves no access-log row either', async () => {
    expect((await post('/staff/read', { org_id: 'o1', reason: 'because I am curious' }, 'owner')).status).toBe(403)
    expect((await post('/staff/read', { org_id: 'o1', reason: 'short' }, 'boss')).status).toBe(400)
    expect(db.accessLog).toHaveLength(0)
  })
  test('with a reason: the log row exists BEFORE any row is read, values come back in full, the log is completed, and the read is on the organisation\'s own chain', async () => {
    const res = await post('/staff/read', { org_id: 'o1', reason: 'investigating grievance G-12', actor_user_id: 'i2' }, 'boss')
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.rows).toBe(2); expect(out.items[0].actor.email).toBe('staff.person@acme.in'); expect(out.items[0].net.ip).toBe('203.0.113.45')
    const begin = db.calls.indexOf('dpdp_audit_staff_begin'); const fetch = db.calls.findIndex((c, i) => c === 'dpdp_audit_fetch' && i > begin)
    expect(begin).toBeGreaterThanOrEqual(0); expect(fetch).toBeGreaterThan(begin)
    expect(db.accessLog[0]).toMatchObject({ org: 'o1', reason: 'investigating grievance G-12', rows: 2 })
    const sr = db.rows.filter((r) => r.event_type === 'staff_read'); expect(sr).toHaveLength(1)
    expect(JSON.parse(sr[0].content_canonical).details).toMatchObject({ access_log_id: db.accessLog[0].id, rows: 2 })
  })
  test('legal hold goes through for the owner only', async () => {
    expect((await post('/staff/legal-hold', { org_id: 'o1', hold: true, reason: 'regulator inquiry' }, 'staff')).status).toBe(403)
    expect(await (await post('/staff/legal-hold', { org_id: 'o1', hold: true, reason: 'regulator inquiry 2026' }, 'boss')).json()).toMatchObject({ legalHold: true })
    expect(db.hold.o1).toBe(true)
  })
})

describe('routing, CORS, errors', () => {
  test('/orgs tells the page what this person may do', async () => {
    const o = await (await call('/orgs', { token: 'hod' })).json()
    expect(o.orgs[0]).toMatchObject({ orgId: 'o1', canDownloadOwn: true, canDownloadOrganisation: true, isHod: true, isOwner: false }); expect(o.codeFresh).toBe(true)
    expect((await call('/orgs', { token: 'stale' })).json().then((x: { codeFresh: boolean }) => x.codeFresh)).resolves.toBe(false)
  })
  test('unknown route 404; bad JSON 400; CORS only for the app\'s own origins; OPTIONS answers 204', async () => {
    expect((await call('/nothing', { token: 'owner' })).status).toBe(404)
    expect((await call('/verify', { method: 'POST', body: '{not json', token: 'owner' })).status).toBe(400)
    const ok = await call('/orgs', { token: 'owner', headers: { origin: 'https://dpdp.veridian-aios.com' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://dpdp.veridian-aios.com')
    expect((await call('/orgs', { token: 'owner', headers: { origin: 'https://evil.example' } })).headers.get('access-control-allow-origin')).toBeNull()
    const pre = await call('/my', { method: 'OPTIONS', headers: { origin: 'https://dpdp.veridian-aios.com' } })
    expect(pre.status).toBe(204); expect(pre.headers.get('access-control-allow-headers')).toContain('authorization')
    expect(corsHeaders(null, ['x'])).toEqual({})
  })
  test('an internal fault is a plain 500 with no detail', async () => {
    db.rpc = async () => { throw new Error('secret detail') }
    const res = await call('/orgs', { token: 'owner' })
    expect(res.status).toBe(500); expect(await res.text()).not.toContain('secret detail')
  })
})
