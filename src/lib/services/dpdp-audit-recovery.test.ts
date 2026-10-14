// DPDP audit-fix programme, fix 4 (2026-10-14): why dpdp.audit_event had 0 rows, and the two things that made it hard to tell.
//
// FINDING (read-only checks on the live project, 2026-10-14): the trail was empty because nothing it records had happened since it went live (2026-10-06 08:20 UTC):
// all 324 AI-link calls since then carried a token that matches NO link (link_id null, answered 410: a recurring probe), nobody signed in, nothing changed. A call with
// no matching link is deliberately not written (a scanner must not be able to grow a customer's chain). So the writer was never exercised live.
//
// WHAT WAS FIXED
//  * a key ring that failed once (secret missing or wrong at start-up) was remembered for the life of the function instance, so setting the secret later changed
//    nothing until a restart: cachedKeyRing() builds once, reuses the good ring, and tries again after a failure;
//  * a failed write was visible only in the function log, so "0 rows in dpdp.audit_failure" could not be read as "no write failed": the writer now also notes a CODE
//    (never a value) through dpdp_audit_note_failure (drizzle/0760).
//
// Run: bun test --isolate src/lib/services/dpdp-audit-recovery.test.ts
import { describe, expect, test } from 'bun:test'
import { auditAiLinkCall } from '../../../supabase/functions/_shared/audit/ai-call'
import { cachedKeyRing, generateKeyB64, keyRingFrom } from '../../../supabase/functions/_shared/audit/seal'
import { makeWriter } from '../../../supabase/functions/_shared/audit/writer'
import { FakeAuditDb } from './__test-helpers__/audit-fake-db'

describe('cachedKeyRing: a failure is not remembered', () => {
  test('no secret at first: the call fails; once the secret is set the next call works, with no restart', async () => {
    const env: Record<string, string> = {}
    const ring = cachedKeyRing((n) => env[n])
    await expect(ring()).rejects.toThrow(/DPDP_AUDIT_SEAL_KEY is not set/)
    await expect(ring()).rejects.toThrow(/DPDP_AUDIT_SEAL_KEY is not set/)
    env.DPDP_AUDIT_SEAL_KEY = generateKeyB64()
    const r = await ring()
    expect(r.current.id).toBe('k1')
  })
  test('a wrong secret (not 32 bytes) fails closed, and fixing it works on the next call', async () => {
    const env: Record<string, string> = { DPDP_AUDIT_SEAL_KEY: btoa('too short') }
    const ring = cachedKeyRing((n) => env[n])
    await expect(ring()).rejects.toThrow(/32 bytes/)
    env.DPDP_AUDIT_SEAL_KEY = generateKeyB64()
    expect((await ring()).current.id).toBe('k1')
  })
  test('a good ring is built once and reused', async () => {
    let reads = 0
    const key = generateKeyB64()
    const ring = cachedKeyRing((n) => { if (n === 'DPDP_AUDIT_SEAL_KEY') reads++; return n === 'DPDP_AUDIT_SEAL_KEY' ? key : undefined })
    const a = await ring(); const b = await ring()
    expect(a).toBe(b)
    expect(reads).toBe(1)
  })
})

describe('the writer notes every failure as a code in the database', () => {
  const put = { orgId: 'o1', eventType: 'edit' as const, actorType: 'system' as const }
  const goodRing = () => keyRingFrom((n) => (n === 'DPDP_AUDIT_SEAL_KEY' ? generateKeyB64() : undefined))
  test('no seal key: written nowhere, noted as no_key', async () => {
    const db = new FakeAuditDb([])
    const w = makeWriter(db.rpc, async () => keyRingFrom(() => undefined))
    expect(await w.append(put)).toEqual({ ok: false, error: 'no_key' })
    expect(db.rows).toHaveLength(0)
    expect(db.failures).toEqual([{ source: 'edge_function', error: 'no_key' }])
  })
  test('the database refuses the row: the code is noted, never the content', async () => {
    const db = new FakeAuditDb([])
    db.failAppend = true
    const w = makeWriter(db.rpc, goodRing)
    expect((await w.append(put)).ok).toBe(false)
    expect(db.failures).toEqual([{ source: 'edge_function', error: 'XX000' }])
  })
  test('the call itself throws: noted as rpc_failed, and a failure of the note changes nothing for the caller', async () => {
    const ring = await goodRing()
    const seen: string[] = []
    const w = makeWriter(async (fn) => { seen.push(fn); throw new Error('network') }, async () => ring)
    expect(await w.append(put)).toEqual({ ok: false, error: 'rpc_failed' })
    expect(seen).toEqual(['dpdp_audit_append', 'dpdp_audit_note_failure'])
    expect(w.stats.failed).toBe(1)
  })
  test('a good write notes nothing', async () => {
    const db = new FakeAuditDb([])
    const w = makeWriter(db.rpc, goodRing)
    expect((await w.append(put)).ok).toBe(true)
    expect(db.failures).toEqual([])
  })
})

describe('what the empty trail looked like from outside', () => {
  test('a call whose token matches no link (the live probe) writes no row, by design, and says why', async () => {
    const db = new FakeAuditDb([])
    const w = makeWriter(db.rpc, () => keyRingFrom((n) => (n === 'DPDP_AUDIT_SEAL_KEY' ? generateKeyB64() : undefined)))
    const out = await auditAiLinkCall({ rpc: db.rpc, writer: w, headers: new Headers(), url: new URL('https://x/y'), method: 'GET', relativePath: '/', routeKind: 'manual', status: 410, callId: 'c1', linkId: null, vendorRanges: {} })
    expect(out).toEqual({ written: false, reason: 'unknown_link' })
    expect(db.rows).toHaveLength(0)
    expect(db.failures).toEqual([]) // not a fault: nothing to record
  })
})
