// The daily audit job (supabase/functions/dpdp-audit-lifecycle/handler.ts) and the AI-call audit row (supabase/functions/_shared/audit/ai-call.ts), against fakes.
// The database half of the lifecycle (which days are due, the deletion, the certificate, the legal hold) is proven on real Postgres in dpdp-audit-trail.pglite.test.ts; this file
// proves what the Edge Function does with the plan: who is e-mailed what (a hash only; a link only), what is marked as sent, and that one failing step never stops the rest.
//
// Run: bun test --isolate src/lib/services/dpdp-audit-lifecycle.test.ts
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { groupNotices, headMail, isDeliverable, noticeMail, runDaily, type Deps, type Head, type NoticeItem } from '../../../supabase/functions/dpdp-audit-lifecycle/handler'
import { GUIDE_ROUTES, auditAiLinkCall, classifyAiCall, sha256HexOfBytes } from '../../../supabase/functions/_shared/audit/ai-call'
import { generateKeyB64, keyRingFrom, open } from '../../../supabase/functions/_shared/audit/seal'
import { makeWriter, netFromHeaders } from '../../../supabase/functions/_shared/audit/writer'
import { FakeAuditDb } from './__test-helpers__/audit-fake-db'

const head = (over: Partial<Head> = {}): Head => ({ orgId: 'o1', orgName: 'Acme & Co', headDate: '2026-10-05', headHash: 'ab'.repeat(32), rowCount: 123, lastSeq: 456, ownerEmails: ['owner@acme.in'], ...over })
const notice = (over: Partial<NoticeItem> = {}): NoticeItem => ({ orgId: 'o1', orgName: 'Acme', rowDay: '2025-11-06', ageDays: 335, purgeOn: '2026-11-06', rows: 40, recipients: ['owner@acme.in', 'staff@acme.in'], ...over })

type Call = { fn: string; args: Record<string, unknown> }
function harness(opts: { heads?: Head[]; notices?: NoticeItem[]; purges?: Array<{ orgId: string; throughDay: string }>; sendFails?: (to: string) => boolean; dry?: boolean; planError?: boolean; headsError?: boolean; purgeResult?: unknown } = {}) {
  const calls: Call[] = []
  const sent: Array<{ to: string; subject: string; text: string; html: string; key: string }> = []
  const deps: Deps = {
    appOrigin: 'https://dpdp.veridian-aios.com', now: () => Date.parse('2026-10-06T00:20:00Z'),
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      if (fn === 'dpdp_audit_record_heads') return opts.headsError ? { data: null, error: { message: 'heads down' } } : { data: { day: '2026-10-05', heads: opts.heads ?? [], failures: 2 }, error: null }
      if (fn === 'dpdp_audit_lifecycle_plan') return opts.planError ? { data: null, error: { message: 'plan down' } } : { data: { notices: opts.notices ?? [], purges: opts.purges ?? [], held: [] }, error: null }
      if (fn === 'dpdp_audit_purge') return { data: opts.purgeResult ?? { purged: true, rows: 7 }, error: null }
      return { data: null, error: null }
    },
    send: opts.dry ? null : async (to, subject, text, html, key) => {
      if (opts.sendFails?.(to)) throw new Error('smtp')
      sent.push({ to, subject, text, html, key })
    },
  }
  return { deps, calls, sent }
}

describe('item 5: the daily chain head is e-mailed to the owner: hash only, no personal data', () => {
  test('the mail carries the date, the hash and the count and nothing else about the log', () => {
    const m = headMail(head({ orgName: 'Acme & Co' }))
    expect(m.subject).toBe('DPDP audit log: chain hash for 2026-10-05')
    expect(m.text).toContain('ab'.repeat(32)); expect(m.text).toContain('123'); expect(m.text).toContain('2026-10-05')
    expect(m.html).toContain('Acme &amp; Co'); expect(m.html).not.toContain('Acme & Co')
    for (const leak of ['@', 'login', 'edit', 'delete', 'seq', 'actor']) expect(m.text.replace('dpdp', '')).not.toContain(leak)
  })
  test('every owner is mailed, the head is marked e-mailed once at least one send worked, and a failed address does not stop the others', async () => {
    const h = harness({ heads: [head({ ownerEmails: ['a@acme.in', 'b@acme.in'] })], sendFails: (to) => to === 'a@acme.in' })
    const rep = await runDaily(h.deps)
    expect(h.sent.map((s) => s.to)).toEqual(['b@acme.in']); expect(rep.heads).toEqual({ recorded: 1, emailed: 1, failed: 1 })
    expect(h.calls.filter((c) => c.fn === 'dpdp_audit_mark_head_emailed')).toEqual([{ fn: 'dpdp_audit_mark_head_emailed', args: { p_org: 'o1', p_day: '2026-10-05' } }])
    expect(h.sent[0].key).toBe('dpdp-audit-head/o1/2026-10-05/b@acme.in') // idempotent at the mail provider: a re-run cannot mail it twice
  })
  test('all sends failing leaves it un-marked (tomorrow\'s run offers it again); an organisation with no deliverable owner address is reported, not silently dropped', async () => {
    const h = harness({ heads: [head()], sendFails: () => true })
    await runDaily(h.deps)
    expect(h.calls.some((c) => c.fn === 'dpdp_audit_mark_head_emailed')).toBe(false)
    const h2 = harness({ heads: [head({ ownerEmails: ['x@example.test'] })] })
    const rep = await runDaily(h2.deps)
    expect(rep.errors.join(' ')).toContain('no deliverable owner address for organisation o1'); expect(h2.sent).toHaveLength(0)
  })
  test('dry run (no mail key): heads are recorded, nothing is sent, nothing is marked as sent', async () => {
    const h = harness({ heads: [head()], notices: [notice()], dry: true })
    const rep = await runDaily(h.deps)
    expect(rep.dryRun).toBe(true); expect(rep.heads.recorded).toBe(1); expect(rep.heads.emailed).toBe(0)
    expect(h.calls.some((c) => c.fn === 'dpdp_audit_mark_head_emailed' || c.fn === 'dpdp_audit_mark_notice_sent')).toBe(false)
  })
})

describe('item 6: the day-335 notice is a short message with a link and nothing else', () => {
  test('no log content, no counts, no names, no dates of events: just when deletion happens and where to go', () => {
    const m = noticeMail('https://dpdp.veridian-aios.com/', '2026-11-06')
    expect(m.text).toBe('Some of your DPDP audit log will be deleted on 2026-11-06. You can download a masked copy until then, signed in:\n\nhttps://dpdp.veridian-aios.com/app/#audit-log\n')
    expect(m.subject).toBe('Your DPDP audit log: download before it is deleted')
    expect(m.text.length).toBeLessThan(250)
    expect(m.html).toContain('href="https://dpdp.veridian-aios.com/app/#audit-log"')
  })
  test('one e-mail per person however many day-batches are due; the earliest deletion date is quoted; recipients are de-duplicated case-insensitively', () => {
    const g = groupNotices([notice({ rowDay: '2025-11-06', purgeOn: '2026-11-06', recipients: ['Owner@acme.in', 'staff@acme.in'] }), notice({ rowDay: '2025-11-07', purgeOn: '2026-11-07', recipients: ['owner@acme.in'] })])
    expect([...g.keys()].sort()).toEqual(['owner@acme.in', 'staff@acme.in'])
    expect(g.get('owner@acme.in')!.purgeOn).toBe('2026-11-06'); expect(g.get('owner@acme.in')!.keys).toHaveLength(2); expect(g.get('staff@acme.in')!.keys).toHaveLength(1)
  })
  test('sent once per person; each batch is marked only when nothing failed for it; a batch with a failed recipient is offered again tomorrow', async () => {
    const h = harness({ notices: [notice({ rowDay: '2025-11-06', recipients: ['owner@acme.in', 'staff@acme.in'] }), notice({ orgId: 'o2', rowDay: '2025-11-08', recipients: ['b@beta.in'] })], sendFails: (to) => to === 'staff@acme.in' })
    const rep = await runDaily(h.deps)
    expect(h.sent.map((s) => s.to).sort()).toEqual(['b@beta.in', 'owner@acme.in']); expect(rep.notices).toMatchObject({ dueBatches: 2, emailsSent: 2, emailsFailed: 1, batchesMarked: 1 })
    const marked = h.calls.filter((c) => c.fn === 'dpdp_audit_mark_notice_sent').map((c) => c.args.p_org)
    expect(marked).toEqual(['o2'])
    expect(h.calls.find((c) => c.fn === 'dpdp_audit_mark_notice_sent')!.args).toMatchObject({ p_org: 'o2', p_recipients: 1, p_emails: ['b@beta.in'] }) // only people actually reached are remembered
    for (const s of h.sent) expect(s.text).not.toMatch(/\d+ (rows|entries)|login|edit|delete$/m)
  })
  test('a batch with nobody reachable is marked anyway, so a dead address cannot hold the deletion forever', async () => {
    const h = harness({ notices: [notice({ recipients: ['gone@example.test'] })] })
    const rep = await runDaily(h.deps)
    expect(h.sent).toHaveLength(0); expect(rep.notices.batchesMarked).toBe(1)
    expect(isDeliverable('a@b.co')).toBe(true); expect(isDeliverable('a@example.com')).toBe(false); expect(isDeliverable('nope')).toBe(false)
  })
})

describe('item 6: day 365 deletion and the independence of the steps', () => {
  test('every organisation the database says is due is purged; the report counts rows', async () => {
    const h = harness({ purges: [{ orgId: 'o1', throughDay: '2025-10-01' }, { orgId: 'o2', throughDay: '2025-10-02' }] })
    const rep = await runDaily(h.deps)
    expect(h.calls.filter((c) => c.fn === 'dpdp_audit_purge').map((c) => c.args)).toEqual([{ p_org: 'o1', p_through_day: '2025-10-01' }, { p_org: 'o2', p_through_day: '2025-10-02' }])
    expect(rep.purges).toEqual({ orgs: 2, purged: 2, rows: 14, failed: 0 }); expect(rep.auditFaultsLastDay).toBe(2)
  })
  test('the deletion runs even when mail is not configured (the retention period does not depend on a mail key)', async () => {
    const h = harness({ dry: true, purges: [{ orgId: 'o1', throughDay: '2025-10-01' }] })
    expect((await runDaily(h.deps)).purges.purged).toBe(1)
  })
  test('a failing step is reported and never stops the others', async () => {
    const h = harness({ headsError: true, purges: [{ orgId: 'o1', throughDay: '2025-10-01' }] })
    const rep = await runDaily(h.deps)
    expect(rep.errors.join(' ')).toContain('heads: heads down'); expect(rep.purges.purged).toBe(1)
    const h2 = harness({ planError: true, heads: [head()] })
    const rep2 = await runDaily(h2.deps)
    expect(rep2.errors.join(' ')).toContain('plan: plan down'); expect(rep2.heads.emailed).toBe(1)
  })
  test('the migration schedules this function daily and the database refuses an early or held deletion on its own (pinned, so the two cannot drift apart)', () => {
    const sql = readFileSync(new URL('../../../drizzle/0730_dpdp_audit_trail.sql', import.meta.url), 'utf8')
    expect(sql).toContain("'dpdp-audit-daily'"); expect(sql).toContain("'dpdp-audit-lifecycle'")
    expect(sql).toContain('a row younger than 365 days cannot be deleted'); expect(sql).toContain('this organisation is on legal hold')
    expect(sql).toContain('between 335 and 364')
  })
})

describe('item 9: one audit row per AI work-link call', () => {
  test('classification: reads are ai_read, POSTs are ai_prepare, refusals are denied, server faults keep the type with outcome failed', () => {
    expect(classifyAiCall('GET', 200)).toEqual({ eventType: 'ai_read', outcome: 'ok' })
    expect(classifyAiCall('HEAD', 200).eventType).toBe('ai_read')
    expect(classifyAiCall('POST', 201)).toEqual({ eventType: 'ai_prepare', outcome: 'ok' })
    for (const s of [401, 403, 410, 429]) expect(classifyAiCall('GET', s)).toEqual({ eventType: 'denied', outcome: 'denied' })
    expect(classifyAiCall('GET', 500)).toEqual({ eventType: 'ai_read', outcome: 'failed' })
    expect(classifyAiCall('GET', 404)).toEqual({ eventType: 'ai_read', outcome: 'ok' })
  })
  async function setup() {
    const db = new FakeAuditDb([])
    const ring = await keyRingFrom((n) => (n === 'DPDP_AUDIT_SEAL_KEY' ? generateKeyB64() : undefined))
    const rpc = async (fn: string, a: Record<string, unknown>) => (fn === 'dpdp_audit_link_context'
      ? { data: a.p_link_id === 'L1' ? { found: true, orgId: 'o1', identityId: 'i2', role: 'staff', tokenFp: 'fp-0001', level: 1 } : { found: false }, error: null }
      : db.rpc(fn, a))
    const writer = makeWriter(rpc, async () => ring, () => Date.parse('2026-10-06T10:00:00Z'))
    return { db, ring, rpc, writer }
  }
  const headers = (h: Record<string, string>) => new Headers({ 'user-agent': 'Mozilla/5.0; compatible; ChatGPT-User/1.0', 'x-dpdp-client-ip': '203.0.113.45', 'x-dpdp-client-country': 'US', 'x-dpdp-client-asn': 'AS8075', ...h })
  test('the row holds the fetcher and vendor the SERVER saw, the AI\'s declaration as claims, a mismatch flag, the link id and token fingerprint, the call id, and the guide hash; personal values sealed', async () => {
    const { db, ring, rpc, writer } = await setup()
    const url = new URL('https://x/functions/v1/dpdp-ai-link/TOKEN/jobs?ai_model=claude-sonnet&ai_version=5.5&ai_session=sess-xyz&ai_machine=machine-77')
    const out = await auditAiLinkCall({ rpc, writer, headers: headers({}), url, method: 'GET', relativePath: '/jobs', routeKind: 'manual', status: 200, callId: 'call-1', linkId: 'L1', guideHash: 'g'.repeat(64), vendorRanges: {} })
    expect(out).toEqual({ written: true })
    const row = db.rows[0]; const c = JSON.parse(row.content_canonical)
    expect(row.event_type).toBe('ai_read'); expect(row.actor_user_id).toBe('i2')
    expect(c.actor).toMatchObject({ type: 'ai_link', role: 'staff' }); expect(c.link).toEqual({ id: 'L1', token_fp: 'fp-0001' }); expect(c.ai_call_id).toBe('call-1'); expect(c.request_id).toBe('call-1')
    expect(c.guide_hash).toBe('g'.repeat(64)); expect(c.net).toMatchObject({ country: 'US', asn: 'AS8075' })
    expect(c.ai).toMatchObject({ fetcher: 'ChatGPT-User', vendor_observed_ua: 'OpenAI', vendor_from_declared_model: 'Anthropic', model: 'claude-sonnet', version: '5.5', mismatch: true })
    expect(await open(ring, c.ai.session_id.s, 'o1', 'ai.session_id')).toBe('sess-xyz'); expect(await open(ring, c.net.ip.s, 'o1', 'net.ip')).toBe('203.0.113.45')
    for (const plain of ['203.0.113.45', 'sess-xyz', 'machine-77']) expect(row.content_canonical).not.toContain(plain)
    expect(c.details).toMatchObject({ method: 'GET', path: '/jobs', status: 200, route: 'manual', link_level: 1 })
  })
  test('a guide hash is kept only for guide routes that succeeded; a refusal is denied; a POST is ai_prepare', async () => {
    const { db, rpc, writer } = await setup()
    const url = new URL('https://x/y')
    await auditAiLinkCall({ rpc, writer, headers: headers({}), url, method: 'GET', relativePath: '/jobs', routeKind: 'jobs', status: 200, callId: 'c2', linkId: 'L1', guideHash: 'h'.repeat(64), vendorRanges: {} })
    await auditAiLinkCall({ rpc, writer, headers: headers({}), url, method: 'GET', relativePath: '/', routeKind: 'manual', status: 410, callId: 'c3', linkId: 'L1', guideHash: 'h'.repeat(64), vendorRanges: {} })
    await auditAiLinkCall({ rpc, writer, headers: headers({}), url, method: 'POST', relativePath: '/drafts', routeKind: 'drafts', status: 201, callId: 'c4', linkId: 'L1', vendorRanges: {} })
    const [a, b, c] = db.rows.map((r) => ({ t: r.event_type, c: JSON.parse(r.content_canonical) }))
    expect(a.c.guide_hash).toBeNull(); expect(b.t).toBe('denied'); expect(b.c.guide_hash).toBeNull(); expect(b.c.outcome).toBe('denied'); expect(c.t).toBe('ai_prepare')
    expect(GUIDE_ROUTES).toContain('manual')
  })
  test('a call with no matching link is not written (it stays in the call log only), and a missing link or an audit fault never throws into the call', async () => {
    const { db, rpc, writer } = await setup()
    const url = new URL('https://x/y')
    const base = { rpc, writer, headers: headers({}), url, method: 'GET', relativePath: '/', routeKind: 'manual', status: 410, callId: 'c', vendorRanges: {} }
    expect(await auditAiLinkCall({ ...base, linkId: null })).toEqual({ written: false, reason: 'unknown_link' })
    expect(await auditAiLinkCall({ ...base, linkId: 'GONE' })).toEqual({ written: false, reason: 'link_not_found' })
    expect(db.rows).toHaveLength(0)
    const broken = await auditAiLinkCall({ ...base, linkId: 'L1', rpc: async (fn) => { throw new Error(fn) } })
    expect(broken.written).toBe(false)
    db.failAppend = true
    expect((await auditAiLinkCall({ ...base, linkId: 'L1' })).written).toBe(false)
  })
  test('no seal key configured: the writer reports no_key (loud in the logs) and writes nothing unsealed', async () => {
    const db = new FakeAuditDb([])
    const w = makeWriter(db.rpc, async () => keyRingFrom(() => undefined))
    expect(await w.append({ orgId: 'o1', eventType: 'edit', actorType: 'system' })).toEqual({ ok: false, error: 'no_key' })
    expect(db.rows).toHaveLength(0); expect(w.stats.failed).toBe(1)
  })
  test('network facts come from the proxy / Cloudflare headers, in that order', async () => {
    expect(netFromHeaders(headers({ 'cf-connecting-ip': '1.1.1.1' }))).toMatchObject({ ip: '203.0.113.45', country: 'US', asn: 'AS8075' })
    expect(netFromHeaders(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })).ip).toBe('1.1.1.1')
    expect(netFromHeaders(new Headers({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })).ip).toBe('2.2.2.2')
    expect(netFromHeaders(new Headers()).ip).toBeNull()
    expect(await sha256HexOfBytes(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  test('the function is actually wired: dpdp-ai-link calls the audit hook from the same place it completes the call log, and never lets it fail the call', () => {
    const src = readFileSync(new URL('../../../supabase/functions/dpdp-ai-link/index.ts', import.meta.url), 'utf8')
    expect(src).toContain('auditAiLinkCall(')
    expect(src.indexOf('dpdp_ai_link_log_call_result')).toBeLessThan(src.indexOf('auditAiLinkCall('))
    expect(src).toContain('catch {') ; expect(src).toContain('waitUntil')
    expect(src).not.toContain('nosnippet')
  })
})
