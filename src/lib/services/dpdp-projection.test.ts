/// <reference types="bun-types" />
// WO-DPDP-004 Section 2.2 / WO-DPDP-006 Section 2 -- dpdp.projection() must
// be a real Postgres SQL function (migration 0425), and "the fuzz test is
// the gate, not the code review": seed realistic personal data, run the
// projection, prove none of it appears in the output. Real database
// (SECURITY DEFINER means RLS cannot be relied on to protect this
// function -- the test must exercise the actual deployed function, not a
// mock). Requires DATABASE_URL; 0425 is NOT yet applied as of this
// writing (see HANDOFF_FOR_RAJAT.md), so the "function exists" test below
// is EXPECTED TO FAIL until the Owner pastes that migration -- the
// remaining tests then skip themselves rather than erroring on a missing
// function.
import { beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"

const hasDb = !!process.env.DATABASE_URL
const d = hasDb ? describe : describe.skip

d("dpdp.projection() (real DB, real function)", () => {
  let orgId: string
  let functionExists = false

  beforeAll(async () => {
    if (!hasDb) return
    const { db, dpdpOrganisation } = await import("@/lib/db")
    const suffix = crypto.randomUUID().slice(0, 8)
    const [org] = await db.insert(dpdpOrganisation).values({ name: `Projection Test Org ${suffix}`, slug: `projection-test-${suffix}` }).returning()
    orgId = org.id

    const [{ exists }] = await db.execute<{ exists: boolean }>(
      sql`select exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'dpdp' and p.proname = 'projection') as exists`,
    )
    functionExists = exists
  }, 45_000)

  test("the function exists in the live database (fails until migration 0425 is applied -- see HANDOFF_FOR_RAJAT.md)", () => {
    if (!hasDb) return
    expect(functionExists).toBe(true)
  })

  test("seeded with realistic personal data across every table it touches, the output contains no @, no 10-digit sequence, and none of the seeded names/emails/phones", async () => {
    if (!hasDb || !functionExists) return
    const { db, dpdpDataCategory, dpdpDataLocation, dpdpRelationship, dpdpRightsRequest, dpdpGrievance, dpdpLibraryVersion, dpdpObligationTemplate, dpdpObligation, dpdpOrganisation } = await import("@/lib/db")
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")

    const PLANTED_EMAIL = "priya.sharma@example.test"
    const PLANTED_PHONE = "9876543210"
    const PLANTED_NAME = "Priya Sharma"

    await withDpdpContext({ orgId }, async (tx) => {
      const [advisorOrg] = await tx.insert(dpdpOrganisation).values({ name: "Fuzz Advisor Firm", slug: `fuzz-advisor-${crypto.randomUUID().slice(0, 8)}` }).returning()
      await tx.insert(dpdpRelationship).values({ fromOrg: advisorOrg.id, toOrg: orgId, kind: "advises", agreementSignedAt: new Date() })

      const [category] = await tx.insert(dpdpDataCategory).values({ orgId, category: "Customer records" }).returning()
      // confirmedBy is a free-text field in this schema -- exactly the kind
      // of place a real user might paste a name/email/phone by mistake.
      await tx.insert(dpdpDataLocation).values({
        categoryId: category.id,
        systemName: "Tally",
        pathText: `D:\\Tally\\Data\\0001\\ -- confirmed by ${PLANTED_NAME} (${PLANTED_EMAIL}, ${PLANTED_PHONE})`,
        holderKind: "internal_person",
        state: "confirmed",
        confirmedBy: `${PLANTED_NAME} <${PLANTED_EMAIL}> ${PLANTED_PHONE}`,
      })

      await tx.insert(dpdpRightsRequest).values({ orgId, ref: `FUZZ-${crypto.randomUUID().slice(0, 6)}`, kind: "erasure", arrivedVia: "email", dueAt: new Date(Date.now() + 90 * 86400_000) })
      await tx.insert(dpdpGrievance).values({ orgId, ref: `FUZZ-G-${crypto.randomUUID().slice(0, 6)}`, summary: `${PLANTED_NAME} (${PLANTED_EMAIL}) says we kept emailing after they said stop -- their number is ${PLANTED_PHONE}`, tier: 1, officerDueAt: new Date(Date.now() + 30 * 86400_000), reviewerDueAt: new Date(Date.now() + 60 * 86400_000) })

      const [lib] = await tx.insert(dpdpLibraryVersion).values({ version: `fuzz-${crypto.randomUUID().slice(0, 8)}`, releasedOn: new Date().toISOString().slice(0, 10) }).returning()
      const [tpl] = await tx.insert(dpdpObligationTemplate).values({ libraryVersionId: lib.id, key: `fuzz_${crypto.randomUUID().slice(0, 8)}`, name: "Fuzz test obligation", plainText: "test", proofKind: "declaration", defaultDays: 30, answerableBy: "internal" }).returning()
      await tx.insert(dpdpObligation).values({ orgId, templateId: tpl.id, libraryVersionUsed: lib.id, dueOn: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) })
    })

    const [{ projection }] = await db.execute<{ projection: string }>(sql`select dpdp.projection(${orgId}, now()) as projection`)

    expect(projection).not.toContain("@")
    expect(projection).not.toMatch(/\d{10}/)
    expect(projection).not.toContain(PLANTED_NAME)
    expect(projection).not.toContain(PLANTED_EMAIL)
    expect(projection).not.toContain(PLANTED_PHONE)

    // And it's not just an empty/broken string -- prove it actually
    // reflects the real data seeded above (real counts, not zeros because
    // the query silently failed).
    expect(projection).toMatch(/DUTIES\s+1 total/)
    expect(projection).toMatch(/OUTSIDE FIRMS\s+1 · agreements signed 1/)
    expect(projection).toMatch(/DATA MAP\s+1 categories · 1 located/)
    expect(projection).toMatch(/OPEN REQUESTS\s+1/)
    expect(projection).toMatch(/COMPLAINTS\s+1/)
  }, 30_000)

  test("deterministic: same org, same instant, same bytes", async () => {
    if (!hasDb || !functionExists) return
    const { db } = await import("@/lib/db")
    const asOf = new Date().toISOString()
    const [a] = await db.execute<{ projection: string }>(sql`select dpdp.projection(${orgId}, ${asOf}::timestamptz) as projection`)
    const [b] = await db.execute<{ projection: string }>(sql`select dpdp.projection(${orgId}, ${asOf}::timestamptz) as projection`)
    expect(a.projection).toBe(b.projection)
  }, 30_000)

  test("under 4KB for this typical (small) org", async () => {
    if (!hasDb || !functionExists) return
    const { db } = await import("@/lib/db")
    const [{ projection }] = await db.execute<{ projection: string }>(sql`select dpdp.projection(${orgId}, now()) as projection`)
    expect(Buffer.byteLength(projection, "utf8")).toBeLessThan(4096)
  }, 30_000)
})
