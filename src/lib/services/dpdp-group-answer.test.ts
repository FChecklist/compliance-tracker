/// <reference types="bun-types" />
// WO-DPDP-010 §3 group jobs: proves answerGroupObligation's 3-answer flow
// actually closes the job once everyone has answered (not just when
// everyone says "done" -- the schema's own contract is "answered", any of
// the 3 kinds), rejects a non-member, and that getOnePageData's
// viewerIsGroupMember correctly gates who can even see the job -- the real
// bug found while building this (every staff member saw every group job
// regardless of membership).
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
const { instantiateObligationsForOrg, answerGroupObligation, ServiceError } = await import("./dpdp-obligation-service")
const { getOnePageData, completeOwnerFirstVisit } = await import("./dpdp-onepage-service")
const { db, dpdpIdentity, dpdpIdentityEmail } = await import("@/lib/db")

async function seedIdentity(suffix: string) {
  const email = `wo010-groupans-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

async function buildAllStaffScenario(suffix: string) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const staffA = await seedIdentity(`a-${suffix}`)
  const staffB = await seedIdentity(`b-${suffix}`)
  const outsider = await seedIdentity(`outsider-${suffix}`)

  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO010 Group Answer ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  const ownerMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
  await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", ownerMembership!.id, [
    { area: "All staff", emails: [staffA.email, staffB.email], na: false },
  ])
  // outsider is a real member of the org (named GO) but NOT in "All staff".
  await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", ownerMembership!.id, [
    { area: "Grievance Officer (responsible for DPDP policy)", emails: [outsider.email], na: false },
  ])

  const view = await getOnePageData(org.id, staffA.identityId)
  const groupObligation = view.rows.find((r) => r.isGroup && r.by === "All staff")
  if (!groupObligation) throw new Error("test setup: no 'All staff' group obligation found")
  return { org, owner, staffA, staffB, outsider, groupObligationId: groupObligation.id }
}

d("WO-DPDP-010: group-answer flow", () => {
  test("a group job closes only once EVERY member has answered, regardless of what they answered", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { org, staffA, staffB, groupObligationId } = await buildAllStaffScenario(suffix)

    const afterFirst = await answerGroupObligation(org.id, staffA.identityId, "Staff", groupObligationId, "done")
    expect(afterFirst.state).not.toBe("closed")
    expect(afterFirst.progressDone).toBe(1)

    // "never_had_any" and "cannot" both still count as an ANSWER for
    // closing purposes -- this is the real behaviour the schema comment
    // describes ("x of y have answered"), not "x of y said done".
    const afterSecond = await answerGroupObligation(org.id, staffB.identityId, "Staff", groupObligationId, "never_had_any")
    expect(afterSecond.state).toBe("closed")
    expect(afterSecond.progressDone).toBe(2)
    expect(afterSecond.closedAt).not.toBeNull()
  }, 30_000)

  test("changing your own answer upserts rather than double-counting progress", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { org, staffA, staffB, groupObligationId } = await buildAllStaffScenario(suffix)

    await answerGroupObligation(org.id, staffA.identityId, "Staff", groupObligationId, "cannot")
    const changed = await answerGroupObligation(org.id, staffA.identityId, "Staff", groupObligationId, "done")
    expect(changed.progressDone).toBe(1) // still 1, not 2 -- same person re-answering

    const view = await getOnePageData(org.id, staffA.identityId)
    const row = view.rows.find((r) => r.id === groupObligationId)
    expect(row?.myGroupAnswer).toBe("done")

    // staffB hasn't answered at all yet.
    const viewB = await getOnePageData(org.id, staffB.identityId)
    const rowB = viewB.rows.find((r) => r.id === groupObligationId)
    expect(rowB?.myGroupAnswer).toBeNull()
  }, 30_000)

  test("someone NOT in the group cannot answer for it", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { org, outsider, groupObligationId } = await buildAllStaffScenario(suffix)

    // NOT expect(...).rejects.toThrow(ServiceError) -- found live, reproduced
    // 3x: that matcher genuinely hangs this bun version (1.3.14) past its own
    // 30s test timeout without ever printing a pass/fail summary, for a
    // promise that rejects correctly and near-instantly (~0.5s) when awaited
    // directly in a plain script or via manual try/catch, confirmed by a
    // standalone repro outside bun:test. Root cause not chased further (a
    // bun-test-internal matcher issue, not a bug in answerGroupObligation)
    // -- manual try/catch is the reliable pattern here.
    let threw = false
    try {
      await answerGroupObligation(org.id, outsider.identityId, "Staff", groupObligationId, "done")
    } catch (e) {
      threw = e instanceof ServiceError
    }
    expect(threw).toBe(true)
  }, 30_000)

  test("viewerIsGroupMember is only true for real members -- the bug this session found and fixed", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { org, staffA, outsider, groupObligationId } = await buildAllStaffScenario(suffix)

    const memberView = await getOnePageData(org.id, staffA.identityId)
    const memberRow = memberView.rows.find((r) => r.id === groupObligationId)
    expect(memberRow?.viewerIsGroupMember).toBe(true)

    const outsiderView = await getOnePageData(org.id, outsider.identityId)
    const outsiderRow = outsiderView.rows.find((r) => r.id === groupObligationId)
    expect(outsiderRow?.viewerIsGroupMember).toBe(false)
  }, 30_000)
})
