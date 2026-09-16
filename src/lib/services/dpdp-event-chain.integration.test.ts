/// <reference types="bun-types" />
// WO-DPDP-002 Section 4.1 (Chain test row: "50+ events verify. Tamper with
// one row in a test database and prove the verification fails.")
//
// Real database, real logDpdpEvent/verifyDpdpEventChain -- not mocked; the
// pure-function hash-math properties already have their own coverage in
// dpdp-event-service.test.ts. This test seeds a dedicated, disposable org
// (never a real one) and deletes its events afterward -- but NOT the
// organisation row itself: dpdp.organisation's RLS (drizzle/0419) has
// SELECT/UPDATE/INSERT policies only, no DELETE policy at all (matching
// this product's own "nothing is ever deleted" design), so a small,
// clearly-labeled ("Chain Test Org <suffix>") disposable org row is
// accepted residue, the same tradeoff every real-DB test in this repo
// already makes given there is no separate test database (see CLAUDE.md's
// own "No local database is possible on this machine" note). Requires
// DATABASE_URL; skips cleanly if it isn't set.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db, dpdpEvent, dpdpOrganisation } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { logDpdpEvent, verifyDpdpEventChain } from "./dpdp-event-service"

// Probe-and-skip, not env-presence-and-skip -- see dpdp-task-service.test.ts's
// probeDpdpDatabase for why (CI's placeholder DATABASE_URL is truthy but
// nothing is listening there).
async function probeDpdpDatabase(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false
  const postgres = (await import("postgres")).default
  for (let attempt = 1; attempt <= 3; attempt++) {
    const probe = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 8, idle_timeout: 1 })
    try {
      await probe`select 1`
      await probe.end({ timeout: 5 })
      return true
    } catch {
      try { await probe.end({ timeout: 5 }) } catch {}
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}
const hasDb = await probeDpdpDatabase()
const d = hasDb ? describe : describe.skip

d("dpdp event chain (real DB)", () => {
  const suffix = crypto.randomUUID().slice(0, 8)
  let orgId: string

  beforeAll(async () => {
    if (!hasDb) return
    const [org] = await db.insert(dpdpOrganisation).values({ name: `Chain Test Org ${suffix}`, slug: `chain-test-${suffix}` }).returning()
    orgId = org.id
  }, 20_000)

  afterAll(async () => {
    if (!hasDb || !orgId) return
    await withDpdpContext({ orgId }, (tx) => tx.delete(dpdpEvent).where(eq(dpdpEvent.orgId, orgId)))
  }, 20_000)

  test("a 50-event chain verifies clean, then a tamper is caught", async () => {
    if (!hasDb) return
    // 50 sequential inserts (each does its own prevHash lookup) plus two
    // full-chain verifications is legitimately slower than bun:test's 5s
    // default, especially over this environment's connection latency --
    // not a hang, just real sequential round trips.

    await withDpdpContext({ orgId }, async (tx) => {
      for (let i = 0; i < 50; i++) {
        await logDpdpEvent({ orgId, actorLabel: "Test Actor", kind: "obligation_accepted", summary: `Event ${i}` }, tx)
      }
    })

    const clean = await verifyDpdpEventChain(orgId)
    expect(clean.ok).toBe(true)
    expect(clean.checked).toBe(50)
    expect(clean.brokenAtEventId).toBeNull()

    // Tamper: rewrite one middle event's summary in place, leaving its
    // stored hash and every later row's prevHash untouched -- exactly what
    // "someone edited the record after the fact" looks like at the SQL
    // level, since dpdp.event has no DB-level trigger preventing an UPDATE
    // (append-only is an app-layer convention here, not a DB constraint --
    // flagged separately; this test is about detection, not prevention).
    const rows = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, orgId), orderBy: (t, { asc }) => [asc(t.occurredAt)] }))
    const middle = rows[24]
    await withDpdpContext({ orgId }, (tx) => tx.update(dpdpEvent).set({ summary: "TAMPERED" }).where(eq(dpdpEvent.id, middle.id)))

    const tampered = await verifyDpdpEventChain(orgId)
    expect(tampered.ok).toBe(false)
    expect(tampered.brokenAtEventId).toBe(middle.id)
    expect(tampered.checked).toBe(50)
  }, 30_000)
})
