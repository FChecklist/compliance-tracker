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

const hasDb = !!process.env.DATABASE_URL
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
    await expect(
      withDpdpContext({ orgId }, (tx) => tx.update(dpdpArtefact).set({ filename: "swapped.pdf" }).where(eq(dpdpArtefact.id, artefactId))),
    ).rejects.toThrow(/permission denied/i)
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
