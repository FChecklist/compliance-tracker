/// <reference types="bun-types" />
// WO-DPDP-014 §3/§7: the share action's RPCs (drizzle/0611) exercised over
// the real database, the same way dpdp-browser-rpc-step5.test.ts exercises
// 0609 -- a Supabase Auth JWT is stood in for by the request.jwt.claims GUC
// that auth.jwt() reads, one transaction per call (DATABASE_URL goes
// through the transaction-mode pooler, so session state does not survive a
// statement). Load-bearing assertions:
//   * dpdp_my_referral_code: a decision-maker (the owner; a CA partner
//     named on the CAPARTNER job; a CA manager on CAMGR) gets a STABLE
//     8-char code from the unambiguous alphabet -- the same code on a
//     second call and from a different org, persisted as ONE consented
//     dpdp.referral row, re-read from the table, not from the payload.
//   * a staff member / group member / non-member is refused with 42501's
//     plain English, and no referral row appears for them.
//   * dpdp_record_share_press appends EXACTLY ONE dpdp.event of kind
//     share_press, "<Role> pressed Share", detail = the role key, and no
//     column of that row contains an email address or the person's name;
//     the org's hash chain still verifies.
//   * dpdp_brand_measures (service_role / app_runtime only) counts that
//     press under this ISO week and role, and reports reportsGenerated 0
//     with its note; anon/authenticated cannot call it.
// Manual try/catch rather than expect().rejects -- see
// dpdp-group-answer.test.ts for the bun 1.3.14 matcher hang it avoids.
//
// NOT run by the WO-014 agent (no .env.local in its worktree): the PM
// applies 0611 via the Supabase MCP and runs this afterwards.
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
const { verifyDpdpEventChain } = await import("./dpdp-event-service")
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation, dpdpObligationTemplate, dpdpReferral } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq, inArray, sql: dsql } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/

type CodeResult = { code: string; role: "owner" | "partner" | "manager" }
type PressResult = { ok: boolean; role: string }
type EventRow = { id: string; org_id: string; actor_identity_id: string | null; actor_label: string; kind: string; summary: string; detail: string | null; route: string | null; device: string | null; occurred_at: string; prev_hash: string | null; hash: string }
type WeekRow = { week: string; weekStart: string; sharePresses: { owner: number; partner: number; manager: number; total: number }; referralSignups: number; paidReferrals: number; creditMonths: number; referralsBlocked: number; reportsGenerated: number; reportsNote: string }
type Page = { viewer: { kind: string; caSub: string | null } }

/** One request, as PostgREST would run it: a transaction whose claims die with it. */
async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
async function myReferralCode(email: string, orgId: string | null = null): Promise<CodeResult> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: CodeResult }[]>`select public.dpdp_my_referral_code(${orgId}) as result`
    return result
  })
}
async function recordSharePress(email: string, orgId: string | null = null): Promise<PressResult> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: PressResult }[]>`select public.dpdp_record_share_press(${orgId}) as result`
    return result
  })
}
async function assignPerson(email: string, obligationId: string, address: string): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_assign_person(${obligationId}, ${address}) as result`
    return result
  })
}
async function completeFirstVisit(email: string, orgId: string, assignments: Array<{ area: string; emails: string[]; na: boolean }>) {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_complete_owner_first_visit(${orgId}, ${tx.json(assignments)}) as result`
    return result
  })
}
async function myPage(email: string, orgId: string | null = null): Promise<Page> {
  return asEmail(email, async (tx) => {
    const [{ page }] = await tx<{ page: Page }[]>`select public.dpdp_my_page(${orgId}) as page`
    return page
  })
}
// No claims: the DATABASE_URL role (app_runtime in this repo's env) calls the measures directly, as service_role would.
async function measures(weeks: number): Promise<WeekRow[]> {
  const [{ result }] = await sql<{ result: WeekRow[] }[]>`select public.dpdp_brand_measures(${weeks}::int) as result`
  return result
}
// The raw rows, bypassing dpdp_org_history's shaping, so every column can be
// inspected. dpdp.event is RLS-scoped to current_org_id() (0604), so the
// read runs under the org's tenant context -- the plain DATABASE_URL role
// sees nothing otherwise (found live on the first run: the RPC had written
// the row, the bare read returned 0).
async function shareEvents(orgId: string): Promise<EventRow[]> {
  return withDpdpContext({ orgId }, async (tx) => {
    const rows = await tx.execute(dsql`select * from dpdp.event where org_id = ${orgId} and kind = 'share_press' order by occurred_at`)
    return rows as unknown as EventRow[]
  })
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }

async function seedIdentity(suffix: string) {
  const email = `wo014-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}
async function buildOrg(suffix: string) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO014 ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  return { owner, org }
}
async function jobTagged(orgId: string, roleTag: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const obligations = await tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, orgId) })
    const templates = await tx.query.dpdpObligationTemplate.findMany({ where: inArray(dpdpObligationTemplate.id, [...new Set(obligations.map((o) => o.templateId))]) })
    const byId = new Map(templates.map((t) => [t.id, t]))
    const job = obligations.find((o) => byId.get(o.templateId)?.roleTag === roleTag && o.state === "open")
    expect(job, `no open ${roleTag} job in ${orgId}`).toBeDefined()
    return job!
  })
}
async function referralRowFor(identityId: string) {
  return db.query.dpdpReferral.findFirst({ where: eq(dpdpReferral.identityId, identityId) })
}
// IYYY-Wnn for a naive-UTC "now", the key dpdp_brand_measures emits.
function isoWeekKey(dt: Date): string {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

d("WO-DPDP-014 §3: the referral code, decision-makers only", () => {
  test("owner, CA partner and CA manager get a stable, persisted 8-char code; staff, group members and non-members are refused", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const partner = await seedIdentity(`partner-${suffix}`)
    const manager = await seedIdentity(`manager-${suffix}`)
    const staff = `wo014-staff-${suffix}@example.test`
    const member = `wo014-member-${suffix}@example.test`
    expect((await assignPerson(owner.email, (await jobTagged(org.id, "CAPARTNER")).id, partner.email)).ok).toBe(true)
    expect((await assignPerson(owner.email, (await jobTagged(org.id, "CAMGR")).id, manager.email)).ok).toBe(true)
    await completeFirstVisit(owner.email, org.id, [
      { area: "Customer data", emails: [staff], na: false },
      { area: "All staff", emails: [member], na: false },
    ])
    // The page agrees about who is who (the same rule 0611's gate uses).
    expect((await myPage(partner.email, org.id)).viewer).toMatchObject({ kind: "ca", caSub: "partner" })
    expect((await myPage(manager.email, org.id)).viewer).toMatchObject({ kind: "ca", caSub: "manager" })
    expect((await myPage(staff, org.id)).viewer.kind).toBe("staff")
    expect((await myPage(member, org.id)).viewer.kind).toBe("staff")

    // Owner: a code, the same code again, one consented row, re-read from the table.
    expect(await referralRowFor(owner.identityId)).toBeUndefined()
    const first = await myReferralCode(owner.email, org.id)
    expect(first.role).toBe("owner")
    expect(first.code).toMatch(CODE_RE)
    const again = await myReferralCode(owner.email, org.id)
    expect(again.code).toBe(first.code)
    expect((await myReferralCode(owner.email, null)).code).toBe(first.code) // newest membership -> same person, same code
    const row = await referralRowFor(owner.identityId)
    expect(row?.code).toBe(first.code)
    expect(row?.consentedAt).not.toBeNull()
    expect(row?.state).toBe("active")
    expect(await db.query.dpdpReferral.findMany({ where: eq(dpdpReferral.identityId, owner.identityId) })).toHaveLength(1)

    // CA partner and manager: their own codes, distinct from the owner's.
    const p = await myReferralCode(partner.email, org.id)
    const m = await myReferralCode(manager.email, org.id)
    expect(p.role).toBe("partner")
    expect(m.role).toBe("manager")
    expect(p.code).toMatch(CODE_RE)
    expect(m.code).toMatch(CODE_RE)
    expect(new Set([first.code, p.code, m.code]).size).toBe(3)
    expect((await referralRowFor(partner.identityId))?.code).toBe(p.code)

    // Refusals, in the RPC's own words, and no row for the refused.
    for (const who of [staff, member]) {
      let msg = ""
      try { await myReferralCode(who, org.id) } catch (e) { msg = message(e) }
      expect(msg).toContain("Only the owner, a CA partner or a CA manager can share a referral code")
    }
    const staffIdentity = await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, staff) })
    expect(staffIdentity).toBeDefined()
    expect(await referralRowFor(staffIdentity!.identityId)).toBeUndefined()
    let msg = ""
    try { await myReferralCode(`wo014-nobody-${suffix}@example.test`, org.id) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await sql`select public.dpdp_my_referral_code(${org.id})` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
  }, 240_000)
})

d("WO-DPDP-014 §7: the share press and the measures", () => {
  test("one press = exactly one share_press event with no email in it; the measures count it under this week and role", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const partner = await seedIdentity(`partner2-${suffix}`)
    expect((await assignPerson(owner.email, (await jobTagged(org.id, "CAPARTNER")).id, partner.email)).ok).toBe(true)
    const staff = `wo014-staff2-${suffix}@example.test`
    await completeFirstVisit(owner.email, org.id, [{ area: "Customer data", emails: [staff], na: false }])

    const week = isoWeekKey(new Date())
    const before = (await measures(2)).find((w) => w.week === week)
    expect(before, `no row for ${week}`).toBeDefined()
    expect(await shareEvents(org.id)).toHaveLength(0)

    // Owner presses once.
    expect(await recordSharePress(owner.email, org.id)).toEqual({ ok: true, role: "owner" })
    let events = await shareEvents(org.id)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe("share_press")
    expect(events[0].summary).toBe("Owner pressed Share")
    expect(events[0].detail).toBe("owner")
    expect(events[0].actor_label).toBe("Owner")
    expect(events[0].actor_identity_id).toBe(owner.identityId)
    for (const [col, v] of Object.entries(events[0])) {
      if (col === "occurred_at") continue
      expect(String(v ?? ""), `column ${col}`).not.toContain("@")
      expect(String(v ?? ""), `column ${col}`).not.toContain(owner.email.split("@")[0])
    }
    // The partner presses once, from the same org.
    expect(await recordSharePress(partner.email, org.id)).toEqual({ ok: true, role: "partner" })
    events = await shareEvents(org.id)
    expect(events).toHaveLength(2)
    expect(events[1].summary).toBe("CA partner pressed Share")
    expect(events[1].detail).toBe("partner")
    expect(events[1].actor_label).toBe("CA partner")

    // Staff is refused and writes nothing.
    let msg = ""
    try { await recordSharePress(staff, org.id) } catch (e) { msg = message(e) }
    expect(msg).toContain("Only the owner, a CA partner or a CA manager can share a referral code")
    expect(await shareEvents(org.id)).toHaveLength(2)
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)

    // The measures: +1 owner, +1 partner, +2 total for this week, aggregates only.
    const after = (await measures(2)).find((w) => w.week === week)!
    expect(after.sharePresses.owner - before!.sharePresses.owner).toBe(1)
    expect(after.sharePresses.partner - before!.sharePresses.partner).toBe(1)
    expect(after.sharePresses.manager - before!.sharePresses.manager).toBe(0)
    expect(after.sharePresses.total - before!.sharePresses.total).toBe(2)
    expect(typeof after.referralSignups).toBe("number")
    expect(typeof after.paidReferrals).toBe("number")
    expect(after.reportsGenerated).toBe(0)
    expect(after.reportsNote).toContain("not measured")
    expect(JSON.stringify(after)).not.toContain("@")
    expect(JSON.stringify(after)).not.toContain(org.id)
    const all = await measures(12)
    expect(all).toHaveLength(12)
    expect(all[0].week).toBe(week) // newest first
    expect(all.every((w) => /^\d{4}-W\d{2}$/.test(w.week))).toBe(true)

    // Not a browser function: the authenticated role (a JWT) is refused.
    msg = ""
    try {
      await asEmail(owner.email, async (tx) => {
        await tx`set local role authenticated`
        await tx`select public.dpdp_brand_measures(1)`
      })
    } catch (e) { msg = message(e) }
    expect(msg).toMatch(/permission denied|does not exist|role/i)
  }, 240_000)
})
