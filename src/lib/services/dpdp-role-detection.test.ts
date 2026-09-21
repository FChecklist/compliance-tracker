/// <reference types="bun-types" />
// WO-DPDP-010: proves getOnePageData's detectedRoleKind actually reflects
// who's really named as Grievance Officer / DPDP coordinator on a given
// org, not just a level guess -- and that it's per-ORG (naming someone GO
// in one org doesn't make them GO everywhere).
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
const { getOnePageData, completeOwnerFirstVisit } = await import("./dpdp-onepage-service")
const { db, dpdpIdentity, dpdpIdentityEmail } = await import("@/lib/db")

async function seedIdentity(suffix: string) {
  const email = `wo010-role-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

d("WO-DPDP-010: detectedRoleKind", () => {
  test("a person named as Grievance Officer is detected as 'go'; the owner and an unrelated staff member are not", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const owner = await seedIdentity(`owner-${suffix}`)
    const goPerson = await seedIdentity(`go-${suffix}`)
    const coordPerson = await seedIdentity(`coord-${suffix}`)
    const randomStaff = await seedIdentity(`rand-${suffix}`)

    const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO010 Role Test ${suffix}`, product: "firm" })
    await instantiateObligationsForOrg(org.id, owner.identityId)

    const membership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })

    await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", membership!.id, [
      { area: "Grievance Officer (responsible for DPDP policy)", emails: [goPerson.email], na: false },
      { area: "DPDP coordinator", emails: [coordPerson.email], na: false },
    ])

    // The real bug this test was written to catch: naming someone
    // individually (not via a group) must give them a real dpdp.membership
    // row in this org, or getDpdpAuthContext() -- the only way anyone signs
    // into /dpdp/home -- returns null and they can never see the page
    // they've just been given jobs on.
    const goMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, goPerson.identityId), eq(m.orgId, org.id)) })
    expect(goMembership).not.toBeNull()
    expect(goMembership?.level).toBe("staff")
    const coordMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, coordPerson.identityId), eq(m.orgId, org.id)) })
    expect(coordMembership).not.toBeNull()

    const goView = await getOnePageData(org.id, goPerson.identityId)
    expect(goView.detectedRoleKind).toBe("go")

    const coordView = await getOnePageData(org.id, coordPerson.identityId)
    expect(coordView.detectedRoleKind).toBe("coord")

    const ownerView = await getOnePageData(org.id, owner.identityId)
    expect(ownerView.detectedRoleKind).toBeNull()

    const randomView = await getOnePageData(org.id, randomStaff.identityId)
    expect(randomView.detectedRoleKind).toBeNull()
  }, 30_000)

  test("role detection is per-org: being named GO in one org does not carry over to another", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const owner1 = await seedIdentity(`owner1-${suffix}`)
    const owner2 = await seedIdentity(`owner2-${suffix}`)
    const sharedPerson = await seedIdentity(`shared-${suffix}`)

    const org1 = await createDpdpOrganisation({ identityId: owner1.identityId, name: `WO010 Role Org1 ${suffix}`, product: "firm" })
    await instantiateObligationsForOrg(org1.id, owner1.identityId)
    const membership1 = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner1.identityId), eq(m.orgId, org1.id)) })
    await completeOwnerFirstVisit(org1.id, owner1.identityId, "Owner", membership1!.id, [
      { area: "Grievance Officer (responsible for DPDP policy)", emails: [sharedPerson.email], na: false },
    ])

    const org2 = await createDpdpOrganisation({ identityId: owner2.identityId, name: `WO010 Role Org2 ${suffix}`, product: "firm" })
    await instantiateObligationsForOrg(org2.id, owner2.identityId)
    // sharedPerson is NOT named anything in org2.

    const inOrg1 = await getOnePageData(org1.id, sharedPerson.identityId)
    expect(inOrg1.detectedRoleKind).toBe("go")

    // sharedPerson has no membership in org2 at all -- getOnePageData should
    // still resolve (viewerEmail falls back to a direct identity lookup)
    // and correctly find no GO/coordinator obligation there.
    const inOrg2 = await getOnePageData(org2.id, sharedPerson.identityId)
    expect(inOrg2.detectedRoleKind).toBeNull()
  }, 30_000)
})
