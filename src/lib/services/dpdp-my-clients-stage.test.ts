/// <reference types="bun-types" />
// WO-DPDP-010 §3 "CA firm view" -- drizzle/0612's two fixes to
// public.dpdp_my_clients, found by the Step 6 acceptance run
// (dpdp-app/e2e/ACCEPTANCE-70.md findings 1 and 2), exercised over the real
// database exactly like dpdp-browser-rpc-step5.test.ts (claims via a
// transaction-local set_config, one transaction per RPC call):
//   1. A SCHOOL a CA creates with "+ Add a client" IS on the CA's client
//      list (caSub 'partner', setUpByMe true) even though the institution
//      library has no CAPARTNER/CAMGR job.
//   2. "Where it is" reads "No owner named yet" while no owner exists, and
//      "Waiting for the owner to confirm" only once an owner is named --
//      re-read from dpdp_my_clients after each step, never assumed.
// Falsifiability: before 0612 was applied this file failed on both (finding
// 1: the school was absent; finding 2: "Waiting for the owner to confirm"
// with no owner), recorded in the PR body.
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
const { db, dpdpIdentity, dpdpIdentityEmail } = await import("@/lib/db")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

type Client = { org: { id: string; name: string; product: string }; caSub: "partner" | "manager"; done: number; total: number; whereItIs: string; ownerConfirmedAt: string | null; setUpByMe: boolean }
type CreateClientResult = { ok: boolean; orgId: string; jobs: number; ownerMembershipId: string | null }
type ConfirmResult = { ok: boolean; alreadyConfirmed: boolean }

async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
async function myClients(email: string): Promise<Client[]> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: Client[] }[]>`select public.dpdp_my_clients() as result`
    return result
  })
}
async function createClientOrg(email: string, name: string, product: string, ownerEmail: string | null): Promise<CreateClientResult> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: CreateClientResult }[]>`select public.dpdp_create_client_org(${name}, ${product}, ${ownerEmail}) as result`
    return result
  })
}
async function ownerConfirm(email: string, orgId: string): Promise<ConfirmResult> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: ConfirmResult }[]>`select public.dpdp_owner_confirm_setup(${orgId}) as result`
    return result
  })
}
async function seedIdentity(suffix: string) {
  const email = `wo010-mc-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

d("WO-DPDP-010 §3: dpdp_my_clients after drizzle/0612", () => {
  test("a school the CA set up is on their client list, and 'Where it is' says who is still missing", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const ca = await seedIdentity(`ca-${suffix}`)
    // The CA firm's own file gives them the membership that lets them create clients.
    await createDpdpOrganisation({ identityId: ca.identityId, name: `WO010 MC CA firm ${suffix}`, product: "firm" })

    // Finding 1: a school, no owner named.
    const school = await createClientOrg(ca.email, `WO010 MC School ${suffix}`, "institution", null)
    expect(school.ok).toBe(true)
    expect(school.ownerMembershipId).toBeNull()
    let clients = await myClients(ca.email)
    const schoolRow = clients.find((c) => c.org.id === school.orgId)
    expect(schoolRow, "the school must be on the CA's client list").toBeDefined()
    expect(schoolRow!.caSub).toBe("partner")
    expect(schoolRow!.setUpByMe).toBe(true)
    expect(schoolRow!.org.product).toBe("institution")
    // Finding 2: nobody exists who could confirm.
    expect(schoolRow!.whereItIs).toBe("No owner named yet")

    // A firm WITH an owner named: the original label is still right.
    const ownerEmail = `wo010-mc-owner-${suffix}@example.test`
    const firm = await createClientOrg(ca.email, `WO010 MC Firm ${suffix}`, "firm", ownerEmail)
    expect(firm.ok).toBe(true)
    expect(firm.ownerMembershipId).toBeTruthy()
    clients = await myClients(ca.email)
    const firmRow = clients.find((c) => c.org.id === firm.orgId)
    expect(firmRow?.whereItIs).toBe("Waiting for the owner to confirm")
    expect(firmRow?.caSub).toBe("partner")

    // Once the owner confirms, the stage moves on (nothing done yet).
    const confirm = await ownerConfirm(ownerEmail, firm.orgId)
    expect(confirm.ok).toBe(true)
    clients = await myClients(ca.email)
    expect(clients.find((c) => c.org.id === firm.orgId)?.whereItIs).toBe("Not started")
    expect(clients.find((c) => c.org.id === firm.orgId)?.ownerConfirmedAt).not.toBeNull()

    // Ordering unchanged: oldest client relationship first.
    const ids = clients.map((c) => c.org.id)
    expect(ids.indexOf(school.orgId)).toBeLessThan(ids.indexOf(firm.orgId))
  }, 240_000)
})
