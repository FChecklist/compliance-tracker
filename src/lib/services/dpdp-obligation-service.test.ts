/// <reference types="bun-types" />
// WO-DPDP-010: proves instantiateObligationsForOrg's product filter (added
// this WO -- the 0.2-wo010 library holds BOTH firm's 31 jobs and
// institution's 28 jobs together, so an org must only ever receive its own
// product's jobs) and the escalation-chain wiring (obligation.
// dependsOnObligationId, resolved from the template's dependsOnKey at
// instantiation time). Same probe-and-skip real-DB pattern as
// dpdp-task-service.test.ts -- this exercises the real, live
// dpdp_lib_0_2_wo010 library seeded by drizzle/0602, not a synthetic one.
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
const { instantiateObligationsForOrg } = await import("./dpdp-obligation-service")
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation, dpdpObligationTemplate } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

async function seedIdentity(suffix: string) {
  const email = `wo010-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return identity.id
}

d("WO-DPDP-010: product-filtered obligation instantiation", () => {
  test("a 'firm' org gets exactly the 31 firm jobs, none of the 28 institution jobs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const identityId = await seedIdentity(`firm-${suffix}`)
    const org = await createDpdpOrganisation({ identityId, name: `WO010 Firm Test ${suffix}`, product: "firm" })

    const obligations = await instantiateObligationsForOrg(org.id, identityId)
    expect(obligations.length).toBe(31)

    const templateIds = obligations.map((o) => o.templateId)
    const templates = await withDpdpContext({ orgId: org.id }, (tx) =>
      Promise.all(templateIds.map((id) => tx.query.dpdpObligationTemplate.findFirst({ where: eq(dpdpObligationTemplate.id, id) })))
    )
    expect(templates.every((t) => t?.product === "firm")).toBe(true)
  }, 30_000)

  test("an 'institution' org gets exactly the 28 institution jobs, none of the 31 firm jobs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const identityId = await seedIdentity(`inst-${suffix}`)
    const org = await createDpdpOrganisation({ identityId, name: `WO010 Institution Test ${suffix}`, product: "institution" })

    const obligations = await instantiateObligationsForOrg(org.id, identityId)
    expect(obligations.length).toBe(28)

    const templateIds = obligations.map((o) => o.templateId)
    const templates = await withDpdpContext({ orgId: org.id }, (tx) =>
      Promise.all(templateIds.map((id) => tx.query.dpdpObligationTemplate.findFirst({ where: eq(dpdpObligationTemplate.id, id) })))
    )
    expect(templates.every((t) => t?.product === "institution")).toBe(true)
  }, 30_000)

  test("the escalation chain resolves: 'CA partner signs' depends on the real 'CA manager checks' obligation id, which depends on the real 'Owner confirms' obligation id", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const identityId = await seedIdentity(`chain-${suffix}`)
    const org = await createDpdpOrganisation({ identityId, name: `WO010 Chain Test ${suffix}`, product: "firm" })

    await instantiateObligationsForOrg(org.id, identityId)

    const rows = await withDpdpContext({ orgId: org.id }, (tx) =>
      tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, org.id) })
    )
    const withTemplate = await Promise.all(
      rows.map(async (o) => ({ o, t: await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligationTemplate.findFirst({ where: eq(dpdpObligationTemplate.id, o.templateId) })) }))
    )
    const ownerConfirms = withTemplate.find((x) => x.t?.key === "firm-29")!
    const caManagerChecks = withTemplate.find((x) => x.t?.key === "firm-30")!
    const caPartnerSigns = withTemplate.find((x) => x.t?.key === "firm-31")!

    expect(ownerConfirms.o.dependsOnObligationId).toBeNull()
    expect(caManagerChecks.o.dependsOnObligationId).toBe(ownerConfirms.o.id)
    expect(caPartnerSigns.o.dependsOnObligationId).toBe(caManagerChecks.o.id)
  }, 30_000)

  test("calling instantiateObligationsForOrg twice does not duplicate obligations (idempotent)", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const identityId = await seedIdentity(`idem-${suffix}`)
    const org = await createDpdpOrganisation({ identityId, name: `WO010 Idempotent Test ${suffix}`, product: "firm" })

    const first = await instantiateObligationsForOrg(org.id, identityId)
    const second = await instantiateObligationsForOrg(org.id, identityId)
    expect(first.length).toBe(31)
    expect(second.length).toBe(31)
  }, 30_000)
})
