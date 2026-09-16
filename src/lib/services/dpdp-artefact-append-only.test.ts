/// <reference types="bun-types" />
// WO-DPDP-002 Section 4.1 (Schema test row): "Append-only trigger rejects
// an artefact content UPDATE. Redaction keeps the row and the chain."
//
// Not actually a trigger here -- drizzle/0415 enforces this via Postgres
// column-level GRANTs (app_runtime has UPDATE only on
// effective_to/superseded_by_id/lifecycle_state/redacted_at/redacted_by/
// redaction_reason/updated_at, never on filename/mime/sha256/the t* content
// columns), which is a real, DB-enforced mechanism -- a permission error
// from Postgres itself, not an app-level check a raw query could bypass.
// This test proves both directions: a content-column UPDATE fails, and the
// legitimate redaction-column UPDATE succeeds, on the exact same row.
//
// Real database, real GRANTs. Requires DATABASE_URL; skips cleanly if unset.
import { beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db, dpdpArtefact, dpdpLibraryVersion, dpdpObligation, dpdpObligationTemplate, dpdpOrganisation } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"

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

d("dpdp.artefact append-only (real DB, real GRANTs)", () => {
  let orgId: string
  let artefactId: string

  beforeAll(async () => {
    if (!hasDb) return
    const suffix = crypto.randomUUID().slice(0, 8)
    const [org] = await db.insert(dpdpOrganisation).values({ name: `Artefact Test Org ${suffix}`, slug: `artefact-test-${suffix}` }).returning()
    orgId = org.id
    await withDpdpContext({ orgId }, async (tx) => {
      const [lib] = await tx.insert(dpdpLibraryVersion).values({ version: `artefact-test-${suffix}`, releasedOn: new Date().toISOString().slice(0, 10) }).returning()
      const [tpl] = await tx
        .insert(dpdpObligationTemplate)
        .values({ libraryVersionId: lib.id, key: `artefact_test_${suffix}`, name: "Artefact test obligation", plainText: "test", proofKind: "doc", defaultDays: 30, answerableBy: "internal" })
        .returning()
      const [obligation] = await tx
        .insert(dpdpObligation)
        .values({ orgId, templateId: tpl.id, libraryVersionUsed: lib.id, dueOn: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) })
        .returning()
      const [artefact] = await tx.insert(dpdpArtefact).values({ obligationId: obligation.id, orgId, filename: "original-proof.pdf" }).returning()
      artefactId = artefact.id
    })
  }, 30_000)

  test("app_runtime cannot update a content column (filename) -- real Postgres permission error", async () => {
    if (!hasDb) return
    // drizzle-orm wraps the driver error in a generic "Failed query: ..."
    // DrizzleQueryError -- the real Postgres message (D2's required
    // "failing UPDATE, error text") is on .cause, not .message.
    let caught: unknown
    try {
      await withDpdpContext({ orgId }, (tx) => tx.update(dpdpArtefact).set({ filename: "swapped.pdf" }).where(eq(dpdpArtefact.id, artefactId)))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const cause = (caught as Error).cause
    expect(String((cause as Error)?.message ?? cause)).toMatch(/permission denied/i)
  }, 30_000)

  test("app_runtime CAN update the redaction columns -- the row and its id stay, only redaction fields change", async () => {
    if (!hasDb) return
    await withDpdpContext({ orgId }, (tx) =>
      tx.update(dpdpArtefact).set({ redactedAt: new Date(), redactedBy: "test-actor", redactionReason: "test redaction" }).where(eq(dpdpArtefact.id, artefactId)),
    )
    const row = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpArtefact.findFirst({ where: eq(dpdpArtefact.id, artefactId) }))
    expect(row).toBeTruthy()
    expect(row!.id).toBe(artefactId)
    expect(row!.redactionReason).toBe("test redaction")
    // The original content column is untouched by the redaction -- the row
    // is kept, not rewritten, exactly as the work order specifies.
    expect(row!.filename).toBe("original-proof.pdf")
  }, 30_000)
})
