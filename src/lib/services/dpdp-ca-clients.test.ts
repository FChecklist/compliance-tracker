/// <reference types="bun-types" />
// WO-DPDP-010 §3 "CA firm view": proves listCaClientOrgs finds every org a
// CA manager/partner was named on (and only those), and that getOnePageData
// detects "ca" the same way it already detects "go"/"coord" -- reusing the
// CAMGR/CAPARTNER roleTag mechanism rather than a new one.
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

const { createDpdpOrganisation, listCaClientOrgs } = await import("./dpdp-organisation-service")
const { instantiateObligationsForOrg } = await import("./dpdp-obligation-service")
const { getOnePageData, completeOwnerFirstVisit } = await import("./dpdp-onepage-service")
const { db, dpdpIdentity, dpdpIdentityEmail } = await import("@/lib/db")

async function seedIdentity(suffix: string) {
  const email = `wo010-caclients-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

async function buildClientOrg(suffix: string, caEmail: string, caArea: "CA partner" | "CA manager" | null) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO010 CA Client ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  if (caArea) {
    const ownerMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
    // The seeded library's own roleTag labels for these two "Sign off" jobs
    // -- confirmed against scripts/dpdp/gen-library-seed.mjs's own J(7, ...)
    // rows ("CA manager checks the proof" / "CA partner signs the file").
    // completeOwnerFirstVisit keys assignments by roleTag, which for these
    // two rows IS the literal role tag string, same as every other area.
    await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", ownerMembership!.id, [
      { area: caArea === "CA partner" ? "CAPARTNER" : "CAMGR", emails: [caEmail], na: false },
    ])
  }
  return org
}

d("WO-DPDP-010: CA firm clients", () => {
  test("a CA partner is found across multiple client orgs, and NOT for an org they aren't named on", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const ca = await seedIdentity(`partner-${suffix}`)
    const clientA = await buildClientOrg(`a-${suffix}`, ca.email, "CA partner")
    const clientB = await buildClientOrg(`b-${suffix}`, ca.email, "CA manager")
    await buildClientOrg(`c-${suffix}`, ca.email, null) // not named on this one at all

    const clients = await listCaClientOrgs(ca.identityId)
    const clientIds = clients.map((c) => c.org.id)
    expect(clientIds).toContain(clientA.id)
    expect(clientIds).toContain(clientB.id)
    expect(clients).toHaveLength(2)

    const asPartner = clients.find((c) => c.org.id === clientA.id)
    expect(asPartner?.caSub).toBe("partner")
    const asManager = clients.find((c) => c.org.id === clientB.id)
    expect(asManager?.caSub).toBe("manager")
    // Every seeded firm org has 31 live (non-na) jobs; none answered yet.
    expect(asPartner?.total).toBe(31)
    expect(asPartner?.done).toBe(0)
  }, 30_000)

  test("getOnePageData detects 'ca' the same way it detects 'go'/'coord'", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const ca = await seedIdentity(`viewmodel-${suffix}`)
    const client = await buildClientOrg(`vm-${suffix}`, ca.email, "CA partner")

    const view = await getOnePageData(client.id, ca.identityId)
    expect(view.detectedRoleKind).toBe("ca")
    expect(view.detectedCaSub).toBe("partner")
  }, 30_000)

  test("someone with no CA role anywhere gets an empty list", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const nobody = await seedIdentity(`nobody-${suffix}`)
    const clients = await listCaClientOrgs(nobody.identityId)
    expect(clients).toHaveLength(0)
  }, 30_000)
})
