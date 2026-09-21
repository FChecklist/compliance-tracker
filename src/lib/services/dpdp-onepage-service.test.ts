/// <reference types="bun-types" />
// WO-DPDP-010: proves getOnePageData's row order is stable and matches the
// library's own sequence (template.key, e.g. "firm-01".."firm-31"), not
// Postgres's unordered default. Found live via a real UPDATE (a manual
// Mark Yes test) shifting which row Postgres returned first for the exact
// same SELECT with no ORDER BY -- this test reproduces that shift directly
// rather than trusting the fix by inspection.
import { describe, expect, test } from "bun:test"

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

const { createDpdpOrganisation } = await import("./dpdp-organisation-service")
const { instantiateObligationsForOrg, markObligationDone } = await import("./dpdp-obligation-service")
const { getOnePageData } = await import("./dpdp-onepage-service")
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation, dpdpObligationTemplate } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

async function seedIdentity(suffix: string) {
  const email = `wo010-order-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return identity.id
}

d("WO-DPDP-010: getOnePageData row ordering", () => {
  test("rows are always returned in template-key order (firm-01..firm-31), even after an UPDATE reshuffles Postgres's own unordered result order", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const identityId = await seedIdentity(suffix)
    const org = await createDpdpOrganisation({ identityId, name: `WO010 Order Test ${suffix}`, product: "firm" })
    await instantiateObligationsForOrg(org.id, identityId)

    const before = await getOnePageData(org.id, identityId)
    const keysBefore = await withDpdpContext({ orgId: org.id }, (tx) =>
      Promise.all(before.rows.map(async (r) => {
        const o = await tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, r.id) })
        const t = await tx.query.dpdpObligationTemplate.findFirst({ where: eq(dpdpObligationTemplate.id, o!.templateId) })
        return t!.key
      }))
    )
    expect(keysBefore).toEqual([...keysBefore].sort())

    // Simulate the exact real-world trigger: close one job out of order
    // (an UPDATE), which is what actually reshuffled Postgres's unordered
    // result the first time this bug was found live.
    const middleRow = before.rows[15]
    await markObligationDone(org.id, identityId, "Owner", middleRow.id)

    const after = await getOnePageData(org.id, identityId)
    const keysAfter = await withDpdpContext({ orgId: org.id }, (tx) =>
      Promise.all(after.rows.map(async (r) => {
        const o = await tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, r.id) })
        const t = await tx.query.dpdpObligationTemplate.findFirst({ where: eq(dpdpObligationTemplate.id, o!.templateId) })
        return t!.key
      }))
    )
    expect(keysAfter).toEqual([...keysAfter].sort())
    expect(keysAfter).toEqual(keysBefore) // same set, same order, before and after the UPDATE
  }, 30_000)
})
