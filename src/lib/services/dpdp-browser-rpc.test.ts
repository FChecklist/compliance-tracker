/// <reference types="bun-types" />
// WO-DPDP-011 Step 2: the browser-side RPCs (drizzle/0604) exercised over
// the real database, standing in for a Supabase Auth JWT by setting the
// same request.jwt.claims GUC that auth.jwt() reads. The load-bearing
// assertion is verifyDpdpEventChain(): the SQL port of the TS hash chain
// must re-hash from JS byte-for-byte, or every browser write would
// silently break the org's audit chain.
import { afterAll, describe, expect, test } from "bun:test"

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

const postgres = (await import("postgres")).default
const { createDpdpOrganisation } = await import("./dpdp-organisation-service")
const { instantiateObligationsForOrg } = await import("./dpdp-obligation-service")
const { completeOwnerFirstVisit } = await import("./dpdp-onepage-service")
const { verifyDpdpEventChain } = await import("./dpdp-event-service")
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation } = await import("@/lib/db")
const { eq } = await import("drizzle-orm")

// One connection, so a session-level set_config persists across statements
// exactly the way one signed-in browser's JWT would.
const rpc = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await rpc.end({ timeout: 5 }) } catch {} })

type Row = { id: string; by: string | null; isGroup: boolean; yes: boolean; na: boolean; due: string; sent: number; dependsOnObligationId: string | null }
type Page = { org: { id: string }; viewer: { email: string; kind: string }; rows: Row[] }

async function asEmail(email: string) {
  await rpc`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, false)`
}
async function myPage(): Promise<Page> {
  const [{ page }] = await rpc<{ page: Page }[]>`select public.dpdp_my_page() as page`
  return page
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }

async function seedIdentity(suffix: string) {
  const email = `wo011-rpc-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

async function buildOrg(suffix: string) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO011 RPC ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  return { owner, org }
}

d("WO-DPDP-011 Step 2: browser RPCs", () => {
  test("owner: my_page returns the org's 31 jobs, mark_done closes one, and the event chain still verifies", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)

    await asEmail(owner.email)
    const page = await myPage()
    expect(page.org.id).toBe(org.id)
    expect(page.viewer.kind).toBe("owner")
    expect(page.viewer.email).toBe(owner.email)
    expect(page.rows).toHaveLength(31)
    for (const r of page.rows) {
      expect(r.due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r).not.toHaveProperty("template_key")
      expect(r.sent).toBe(0)
    }

    const target = page.rows.find((r) => !r.yes && !r.na && !r.dependsOnObligationId)
    expect(target).toBeDefined()
    const [{ result }] = await rpc<{ result: { ok: boolean } }[]>`select public.dpdp_mark_done(${target!.id}) as result`
    expect(result.ok).toBe(true)

    const closed = await db.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, target!.id) })
    expect(closed?.state).toBe("closed")
    expect(closed?.closedBy).toBe(owner.identityId)

    // The proof that the SQL hash chain IS the TS hash chain: the event the
    // RPC appended must re-verify from JS, on top of the TS-written events
    // (organisation_created, obligation_assigned) already in the chain.
    const chain = await verifyDpdpEventChain(org.id)
    expect(chain.ok).toBe(true)
    expect(chain.checked).toBeGreaterThanOrEqual(3)

    const again = await myPage()
    expect(again.rows.find((r) => r.id === target!.id)?.yes).toBe(true)
  }, 60_000)

  test("the escalation chain still gates mark_done, with the same plain-English message", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner } = await buildOrg(suffix)
    await asEmail(owner.email)
    const page = await myPage()
    const blocked = page.rows.find((r) =>
      r.dependsOnObligationId && !r.yes && !r.na && page.rows.some((dep) => dep.id === r.dependsOnObligationId && !dep.yes && !dep.na)
    )
    expect(blocked).toBeDefined()
    // Manual try/catch, not expect().rejects -- see dpdp-group-answer.test.ts
    // for the bun 1.3.14 matcher hang this avoids.
    let msg = ""
    try { await rpc`select public.dpdp_mark_done(${blocked!.id})` } catch (e) { msg = message(e) }
    expect(msg).toContain("Waiting — the step before this one isn't done yet")
  }, 60_000)

  test("a signed-in email with no membership, and a staff member on someone else's job, are both refused", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const staff = await seedIdentity(`staff-${suffix}`)
    const ownerMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
    await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", ownerMembership!.id, [
      { area: "Customer data", emails: [staff.email], na: false },
    ])

    const nobody = await seedIdentity(`nobody-${suffix}`)
    await asEmail(nobody.email)
    let msg = ""
    try { await myPage() } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")

    await asEmail(staff.email)
    const page = await myPage()
    expect(page.viewer.kind).toBe("staff")
    expect(page.rows.some((r) => r.by === staff.email)).toBe(true)
    const notMine = page.rows.find((r) => r.by !== staff.email && !r.isGroup && !r.yes && !r.na)
    expect(notMine).toBeDefined()
    msg = ""
    try { await rpc`select public.dpdp_mark_done(${notMine!.id})` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not your job")
  }, 60_000)
})
