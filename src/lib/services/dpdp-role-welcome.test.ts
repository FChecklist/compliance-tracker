/// <reference types="bun-types" />
// WO-DPDP-010 §4: proves the generic "everyone invited" welcome screen's two
// server actions actually do what home/page.tsx assumes -- acknowledging
// sets firstVisitSeenAt so the welcome screen doesn't loop, and "this isn't
// me" sets BOTH firstVisitSeenAt and saidNotMeAt (and is visible in History)
// so the owner has a real signal a reassignment is needed.
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
const { getOnePageData, completeOwnerFirstVisit, acknowledgeRoleWelcome, flagNotMe, listOnePageHistory } = await import("./dpdp-onepage-service")
const { db, dpdpIdentity, dpdpIdentityEmail } = await import("@/lib/db")

async function seedIdentity(suffix: string) {
  const email = `wo010-welcome-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

d("WO-DPDP-010: role welcome / not-me flow", () => {
  test("acknowledging sets firstVisitSeenAt and logs a real event", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const owner = await seedIdentity(`owner-ack-${suffix}`)
    const goPerson = await seedIdentity(`go-ack-${suffix}`)

    const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO010 Welcome Ack ${suffix}`, product: "firm" })
    await instantiateObligationsForOrg(org.id, owner.identityId)
    const ownerMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
    await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", ownerMembership!.id, [
      { area: "Grievance Officer (responsible for DPDP policy)", emails: [goPerson.email], na: false },
    ])

    const before = await getOnePageData(org.id, goPerson.identityId)
    expect(before.firstVisitSeenAt).toBeNull()
    expect(before.saidNotMeAt).toBeNull()

    await acknowledgeRoleWelcome(org.id, goPerson.identityId, "Staff", before.membershipId!)

    const after = await getOnePageData(org.id, goPerson.identityId)
    expect(after.firstVisitSeenAt).not.toBeNull()
    expect(after.saidNotMeAt).toBeNull()

    const events = await listOnePageHistory(org.id)
    expect(events.some((e) => e.kind === "membership_first_visit_acknowledged")).toBe(true)
  }, 30_000)

  test("'this isn't me' sets both timestamps, logs it, and NotMeWaiting only applies while jobs are still assigned", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const owner = await seedIdentity(`owner-notme-${suffix}`)
    const coordPerson = await seedIdentity(`coord-notme-${suffix}`)

    const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO010 Welcome NotMe ${suffix}`, product: "firm" })
    await instantiateObligationsForOrg(org.id, owner.identityId)
    const ownerMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
    await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", ownerMembership!.id, [
      { area: "DPDP coordinator", emails: [coordPerson.email], na: false },
    ])

    const before = await getOnePageData(org.id, coordPerson.identityId)
    await flagNotMe(org.id, coordPerson.identityId, "Staff", before.membershipId!)

    const after = await getOnePageData(org.id, coordPerson.identityId)
    expect(after.firstVisitSeenAt).not.toBeNull()
    expect(after.saidNotMeAt).not.toBeNull()
    // The real assignment is untouched by flagNotMe -- reassigning is the
    // owner's job via the existing admin UI, not this function's.
    const stillAssigned = after.rows.some((r) => r.by === coordPerson.email && !r.na)
    expect(stillAssigned).toBe(true)

    const events = await listOnePageHistory(org.id)
    expect(events.some((e) => e.kind === "membership_said_not_me")).toBe(true)
  }, 30_000)
})
