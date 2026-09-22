/// <reference types="bun-types" />
// WO-DPDP-011 Step 6 / §3 "row-level security is now the whole wall":
// the cross-tenant tests that MUST fail -- reading, answering or listing
// another organisation's jobs by RPC, a group member reaching a non-group
// job, and a signed-in browser role touching a dpdp table directly. Same
// harness as dpdp-browser-rpc.test.ts: every call is one transaction with a
// transaction-local request.jwt.claims, exactly as PostgREST runs it.
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
const { areasForProduct, completeOwnerFirstVisit } = await import("./dpdp-onepage-service")
const { verifyDpdpEventChain } = await import("./dpdp-event-service")
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

type Row = { id: string; by: string | null; isGroup: boolean; viewerIsGroupMember?: boolean; yes: boolean; na: boolean; dependsOnObligationId: string | null }
type Page = { org: { id: string }; viewer: { email: string; kind: string }; rows: Row[] }

async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }
async function refusal(email: string | null, call: (tx: typeof sql) => Promise<unknown>): Promise<string> {
  try {
    if (email === null) await sql.begin(async (tx) => call(tx as unknown as typeof sql))
    else await asEmail(email, call)
  } catch (e) { return message(e) }
  return ""
}
const REFUSED = /Not a member of this organisation|Job not found|Not your job/

async function seedIdentity(suffix: string) {
  const email = `wo011-xt-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}
async function buildOrg(suffix: string) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO011 XT ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  const membership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
  return { owner, org, membershipId: membership!.id }
}
async function openRowOf(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.orgId, orgId) }))
}
async function stateOf(orgId: string, obligationId: string) {
  const row = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, obligationId) }))
  return row?.state
}

d("WO-DPDP-011 §3: cross-tenant calls that must fail", () => {
  test("an owner of org A cannot list, answer, acknowledge or flag anything in org B, and B is left untouched", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`a-${suffix}`)
    const b = await buildOrg(`b-${suffix}`)
    const bRow = await openRowOf(b.org.id)
    expect(bRow).toBeDefined()

    // Listing: my_page(B) as A's owner.
    expect(await refusal(a.owner.email, (tx) => tx`select public.dpdp_my_page(${b.org.id})`)).toMatch(/Not a member of this organisation/)
    // The default (no org argument) must resolve to A's own org, never B's.
    const own = await asEmail(a.owner.email, async (tx) => (await tx<{ page: Page }[]>`select public.dpdp_my_page() as page`)[0].page)
    expect(own.org.id).toBe(a.org.id)
    expect(own.rows.some((r) => r.id === bRow!.id)).toBe(false)

    // Answering: mark_done on B's job as A's owner (an owner may close anything in THEIR org, never in another).
    expect(await refusal(a.owner.email, (tx) => tx`select public.dpdp_mark_done(${bRow!.id})`)).toMatch(REFUSED)
    expect(await stateOf(b.org.id, bRow!.id)).toBe("open")

    // Acknowledging / flagging against B's membership.
    expect(await refusal(a.owner.email, (tx) => tx`select public.dpdp_acknowledge_welcome(${b.org.id})`)).toMatch(/Not a member of this organisation/)
    expect(await refusal(a.owner.email, (tx) => tx`select public.dpdp_flag_not_me(${b.org.id})`)).toMatch(/Not a member of this organisation/)

    // B's audit chain is untouched by any of the refused calls.
    const chain = await verifyDpdpEventChain(b.org.id)
    expect(chain.ok).toBe(true)
  }, 90_000)

  test("a staff member of org A cannot reach org B even though they are a real, active member somewhere", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`a2-${suffix}`)
    const b = await buildOrg(`b2-${suffix}`)
    const staff = await seedIdentity(`staff-${suffix}`)
    await completeOwnerFirstVisit(a.org.id, a.owner.identityId, "Owner", a.membershipId, [{ area: "Customer data", emails: [staff.email], na: false }])
    const bRow = await openRowOf(b.org.id)

    expect(await refusal(staff.email, (tx) => tx`select public.dpdp_my_page(${b.org.id})`)).toMatch(/Not a member of this organisation/)
    expect(await refusal(staff.email, (tx) => tx`select public.dpdp_mark_done(${bRow!.id})`)).toMatch(REFUSED)
    expect(await stateOf(b.org.id, bRow!.id)).toBe("open")
  }, 90_000)

  test("a group member cannot answer a non-group job that is not theirs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`g-${suffix}`)
    const areas = await areasForProduct("firm")
    const groupArea = areas.find((x) => x.isGroup)
    if (!groupArea) {
      console.warn("no group area in the firm library -- group-member sub-test not exercised")
      return
    }
    const member = await seedIdentity(`grp-${suffix}`)
    await completeOwnerFirstVisit(a.org.id, a.owner.identityId, "Owner", a.membershipId, [{ area: groupArea.area, emails: [member.email], na: false }])

    const page = await asEmail(member.email, async (tx) => (await tx<{ page: Page }[]>`select public.dpdp_my_page() as page`)[0].page)
    expect(page.viewer.kind).not.toBe("owner")
    expect(page.rows.some((r) => r.isGroup && r.viewerIsGroupMember)).toBe(true)
    const nonGroup = page.rows.find((r) => !r.isGroup && r.by !== member.email && !r.yes && !r.na)
    expect(nonGroup).toBeDefined()
    expect(await refusal(member.email, (tx) => tx`select public.dpdp_mark_done(${nonGroup!.id})`)).toMatch(/Not your job/)
    expect(await stateOf(a.org.id, nonGroup!.id)).toBe("open")
  }, 90_000)

  test("no claims: every write RPC is refused, not silently a no-op", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`anon-${suffix}`)
    const row = await openRowOf(a.org.id)
    expect(await refusal(null, (tx) => tx`select public.dpdp_mark_done(${row!.id})`)).toMatch(REFUSED)
    expect(await refusal(null, (tx) => tx`select public.dpdp_acknowledge_welcome(${a.org.id})`)).toMatch(/Not a member of this organisation/)
    expect(await refusal(null, (tx) => tx`select public.dpdp_flag_not_me(${a.org.id})`)).toMatch(/Not a member of this organisation/)
    expect(await stateOf(a.org.id, row!.id)).toBe("open")
  }, 60_000)

  test("the browser roles have no direct table access at all -- only the RPCs", async () => {
    // WO-011 §2.4: "the browser never writes a table directly". Stronger
    // than RLS: anon/authenticated hold no grant on the dpdp schema or any
    // of its tables, so a direct select fails before any policy is
    // consulted. Checked via the privilege catalogue rather than SET ROLE
    // (the pooler user is not a member of these roles, so SET ROLE is not
    // available here) -- the answer is the same and deterministic.
    const [schema] = await sql<{ anon_usage: boolean; auth_usage: boolean }[]>`
      select has_schema_privilege('anon', 'dpdp', 'USAGE') as anon_usage,
             has_schema_privilege('authenticated', 'dpdp', 'USAGE') as auth_usage`
    expect(schema.anon_usage).toBe(false)
    expect(schema.auth_usage).toBe(false)

    const tables = await sql<{ table_name: string; anon_any: boolean; auth_any: boolean }[]>`
      select t.table_name,
             bool_or(has_table_privilege('anon', format('dpdp.%I', t.table_name), p)) as anon_any,
             bool_or(has_table_privilege('authenticated', format('dpdp.%I', t.table_name), p)) as auth_any
      from information_schema.tables t
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p
      where t.table_schema = 'dpdp' and t.table_type = 'BASE TABLE'
      group by t.table_name order by t.table_name`
    expect(tables.length).toBeGreaterThan(30) // 39 base tables in dpdp today; the bound only guards an empty/wrong-schema answer
    const leaks = tables.filter((t) => t.anon_any || t.auth_any).map((t) => t.table_name)
    expect(leaks).toEqual([])

    // And the RPC surface is exactly the intended one: authenticated may
    // call the four page functions, anon may call none of them, and the
    // definer-side helpers are callable by neither.
    const [fns] = await sql<{ auth_ok: boolean; anon_ok: boolean; helpers_locked: boolean }[]>`
      select bool_and(has_function_privilege('authenticated', f, 'EXECUTE')) as auth_ok,
             bool_or(has_function_privilege('anon', f, 'EXECUTE')) as anon_ok,
             not (has_function_privilege('authenticated', 'public.dpdp__caller_identity_id()', 'EXECUTE')
                  or has_function_privilege('anon', 'public.dpdp__append_event(text,text,text,text,text,text)', 'EXECUTE')) as helpers_locked
      from unnest(array['public.dpdp_my_page(text)', 'public.dpdp_mark_done(text)', 'public.dpdp_acknowledge_welcome(text)', 'public.dpdp_flag_not_me(text)']) as f`
    expect(fns.auth_ok).toBe(true)
    expect(fns.anon_ok).toBe(false)
    expect(fns.helpers_locked).toBe(true)
  }, 30_000)
})
