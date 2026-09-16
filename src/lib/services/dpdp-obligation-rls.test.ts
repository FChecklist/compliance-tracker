/// <reference types="bun-types" />
// WO-DPDP-002 Section 4.1 (RLS test row: "Auditor write is refused").
//
// Real database, real RLS -- not mocked. Every case runs inside ONE
// transaction per test that is always rolled back at the end (thrown
// sentinel caught outside `db.transaction`), so nothing here ever commits,
// matching the work order's own "Run these inside ROLLBACK, never commit"
// instruction. Requires DATABASE_URL (the app's own app_runtime connection,
// the same one every route uses) -- skips cleanly if it isn't set, rather
// than failing CI in an environment with no database at all.
//
// THE FINDING THIS TEST IS BUILT AROUND: dpdp.obligation's original RLS
// policy (0415, app_runtime_relationship_scoped) was a single `FOR ALL`
// policy whose USING clause treated 'advises' and 'audits' relationships
// identically -- both granted the SAME row visibility for SELECT, UPDATE,
// AND DELETE, with no separate WITH CHECK narrowing writes. 0415's own
// comment claimed "auditor cannot write... enforced at the API/service
// layer" -- checked directly, no such check exists in the dpdp route layer
// (every route calls only requireDpdpSession()). Today's app code happens
// not to expose this (loadObligationOrThrow filters WHERE org_id = the
// ACTING org, not just any RLS-visible row) but the database itself would
// allow the write if anything ever queried by obligationId alone. Migration
// 0422 (drizzle/0422_dpdp_obligation_write_restrict_auditors.sql) splits the
// single policy into a broad SELECT policy (unchanged visibility) and
// narrower INSERT/UPDATE/DELETE policies that drop 'audits' from the write
// path. That migration is NOT applied to production as of this test being
// written (blocked by Claude Code's own auto-mode "Production Deploy"
// classifier -- see HANDOFF_FOR_RAJAT.md item 2) -- so this test is
// EXPECTED TO FAIL against current production, and its failure output IS
// the proof the gap is real. It will pass once HANDOFF_FOR_RAJAT.md's SQL
// (== 0422's contents) is applied.
import { beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { db, dpdpLibraryVersion, dpdpObligation, dpdpObligationTemplate, dpdpOrganisation, dpdpRelationship } from "@/lib/db"

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

class TestRollback extends Error {}

/** Runs `fn` inside a real transaction that is ALWAYS rolled back, win or lose. */
async function inRolledBackTx<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  let result: T | undefined
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx)
      throw new TestRollback()
    })
  } catch (e) {
    if (!(e instanceof TestRollback)) throw e
  }
  return result as T
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function setOrgContext(tx: Tx, orgId: string) {
  await tx.execute(sql`select set_config('app.dpdp_org_id', ${orgId}, true)`)
}

/** A client org + an auditor org related to it via 'audits', plus one open obligation belonging to the client. */
async function seedAuditedClientFixture(tx: Tx, suffix: string) {
  const [clientOrg] = await tx.insert(dpdpOrganisation).values({ name: `RLS Test Client ${suffix}`, slug: `rls-test-client-${suffix}` }).returning()
  const [auditorOrg] = await tx.insert(dpdpOrganisation).values({ name: `RLS Test Auditor ${suffix}`, slug: `rls-test-auditor-${suffix}` }).returning()
  const [lib] = await tx.insert(dpdpLibraryVersion).values({ version: `rls-test-${suffix}`, releasedOn: new Date().toISOString().slice(0, 10) }).returning()
  const [tpl] = await tx
    .insert(dpdpObligationTemplate)
    .values({ libraryVersionId: lib.id, key: `rls_test_${suffix}`, name: "RLS test obligation", plainText: "test", proofKind: "declaration", defaultDays: 30, answerableBy: "internal" })
    .returning()

  // The relationship trigger (dpdp_relationship_no_self_declare) requires the
  // acting session's org to equal to_org for an 'audits' relationship -- the
  // AUDITED org asserts who audits it, not the auditor unilaterally. So this
  // INSERT must run as the client, not the auditor.
  await setOrgContext(tx, clientOrg.id)
  await tx.insert(dpdpRelationship).values({ fromOrg: auditorOrg.id, toOrg: clientOrg.id, kind: "audits" })
  const [obligation] = await tx
    .insert(dpdpObligation)
    .values({ orgId: clientOrg.id, templateId: tpl.id, libraryVersionUsed: lib.id, dueOn: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) })
    .returning()

  return { clientOrg, auditorOrg, obligation }
}

d("dpdp.obligation RLS -- auditor write", () => {
  beforeAll(async () => {
    if (!hasDb) return
    // Sanity: this must run as app_runtime (RLS-subject), not a superuser/
    // service_role connection -- otherwise every assertion below would
    // trivially "pass" for the wrong reason (RLS simply not applying).
    const [{ current_user: currentUser }] = await db.execute<{ current_user: string }>(sql`select current_user`)
    expect(currentUser).toBe("app_runtime")
  })

  test("an org with only an 'audits' relationship cannot UPDATE the audited org's obligation", async () => {
    if (!hasDb) return
    const updateSucceeded = await inRolledBackTx(async (tx) => {
      const { auditorOrg, obligation } = await seedAuditedClientFixture(tx, crypto.randomUUID().slice(0, 8))

      // Now act as the AUDITOR and attempt to close the client's obligation --
      // exactly the thing the product's own spec says an auditor must never
      // be able to do ("read everything, change nothing").
      await setOrgContext(tx, auditorOrg.id)
      const updated = await tx.update(dpdpObligation).set({ state: "closed", closedAt: new Date() }).where(sql`${dpdpObligation.id} = ${obligation.id}`).returning()
      return updated.length > 0
    })

    // EXPECTED (post-fix, migration 0422 applied): false -- RLS rejects the
    // write, 0 rows affected. If this is `true`, the auditor's UPDATE went
    // through at the database level -- the gap this test exists to catch.
    expect(updateSucceeded).toBe(false)
  })

  test("the same org CAN still read (SELECT) the audited org's obligation -- the fix must not also break legitimate read access", async () => {
    if (!hasDb) return
    const visibleRowCount = await inRolledBackTx(async (tx) => {
      const { auditorOrg, clientOrg } = await seedAuditedClientFixture(tx, crypto.randomUUID().slice(0, 8))
      await setOrgContext(tx, auditorOrg.id)
      const rows = await tx.select().from(dpdpObligation).where(sql`${dpdpObligation.orgId} = ${clientOrg.id}`)
      return rows.length
    })

    expect(visibleRowCount).toBe(1)
  })
})
