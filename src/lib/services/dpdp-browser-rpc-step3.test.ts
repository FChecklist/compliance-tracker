/// <reference types="bun-types" />
// WO-DPDP-011 Step 3: the owner-side browser RPCs (drizzle/0605) exercised
// over the real database, the same way dpdp-browser-rpc.test.ts exercises
// the Step 2 ones -- a Supabase Auth JWT is stood in for by setting the
// request.jwt.claims GUC that auth.jwt() reads. Load-bearing assertions:
//   * dpdp_areas_for_product returns EXACTLY what areasForProduct() returns
//     (same areas, jobs, order, group flags) -- the wizard's rows must not
//     drift between the two apps while both exist.
//   * dpdp_complete_owner_first_visit persists everything the TS version
//     persists (person / group / n/a / fromArea auto-close / first_visit_
//     seen_at), and verifyDpdpEventChain() still passes afterwards -- this
//     function appends several events inside ONE plpgsql loop, the case
//     0605's occurred_at tie-break exists for.
//   * dpdp_assign_person creates the named person's dpdp.membership row --
//     the WO-011 §4 bug the TS assignObligation() had; the regression test
//     asserts the row exists AND that the person can then actually load
//     dpdp_my_page.
//   * Cross-tenant: an owner of org A gets "Job not found" / "Not a member
//     of this organisation" against org B, never a partial success.
//
// Every RPC call runs inside ONE transaction with a transaction-local
// set_config -- exactly what PostgREST does per request. DATABASE_URL goes
// through Supabase's transaction-mode pooler (port 6543), which hands
// consecutive statements to different backends, so session-level state is
// simply gone by the next statement (found live while writing the Step 2
// test; see its header).
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
const { areasForProduct } = await import("./dpdp-onepage-service")
const { verifyDpdpEventChain } = await import("./dpdp-event-service")
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpMembership, dpdpObligation, dpdpObligationTemplate, dpdpStaffGroup, dpdpStaffGroupMember } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { and, eq, inArray } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

const GO = "Grievance Officer (responsible for DPDP policy)"
const NA_AT_FIRST_VISIT = "Marked ‘doesn’t apply’ at first visit"
const NA_DEFAULT = "Marked ‘doesn’t apply’"

type Row = { id: string; what: string; by: string | null; isGroup: boolean; groupTotal?: number; yes: boolean; na: boolean; due: string; sent: number; dependsOnObligationId: string | null }
type Page = { org: { id: string }; viewer: { email: string; kind: string; firstVisitSeenAt: string | null }; rows: Row[] }
type Area = { area: string; jobs: string[]; isGroup: boolean }
type Assignment = { area: string; emails: string[]; na: boolean }
type FirstVisitResult = { ok: boolean; assigned: number; notApplicable: number }
type HistoryEntry = { id: string; kind: string; summary: string; detail: string | null; actorLabel: string; occurredAt: string }

/** One request, as PostgREST would run it: a transaction whose claims die with it. */
async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
async function myPage(email: string): Promise<Page> {
  return asEmail(email, async (tx) => {
    const [{ page }] = await tx<{ page: Page }[]>`select public.dpdp_my_page() as page`
    return page
  })
}
async function markDone(email: string, obligationId: string): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_mark_done(${obligationId}) as result`
    return result
  })
}
async function areasFor(email: string, product: "firm" | "institution"): Promise<Area[]> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: Area[] }[]>`select public.dpdp_areas_for_product(${product}) as result`
    return result
  })
}
async function completeFirstVisit(email: string, orgId: string, assignments: Assignment[]): Promise<FirstVisitResult> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: FirstVisitResult }[]>`select public.dpdp_complete_owner_first_visit(${orgId}, ${tx.json(assignments)}) as result`
    return result
  })
}
async function assignPerson(email: string, obligationId: string, address: string): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_assign_person(${obligationId}, ${address}) as result`
    return result
  })
}
async function markNotApplicable(email: string, obligationId: string, reason: string | null): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_mark_not_applicable(${obligationId}, ${reason}) as result`
    return result
  })
}
async function history(email: string, orgId: string | null, limit: number | null): Promise<HistoryEntry[]> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: HistoryEntry[] }[]>`select public.dpdp_org_history(${orgId}, ${limit}::int) as result`
    return result
  })
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }

async function seedIdentity(suffix: string) {
  const email = `wo011-s3-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

async function buildOrg(suffix: string) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO011 S3 ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  return { owner, org }
}

// identity_email carries no RLS (0604's header: one of the 17 dpdp tables
// without any), so the plain client sees every row; lower() because the RPC
// stores lowercased addresses whatever case the caller typed.
async function identityIdFor(email: string): Promise<string | null> {
  const row = await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, email.trim().toLowerCase()) })
  return row?.identityId ?? null
}

// Under the org's tenant context, not the plain db client: dpdp.obligation /
// staff_group / staff_group_member are RLS-scoped to current_org_id() and
// silently return nothing without it (the same trap 0604's test documents).
async function obligationsWithTemplates(orgId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const obligations = await tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, orgId) })
    const templateIds = [...new Set(obligations.map((o) => o.templateId))]
    const templates = templateIds.length ? await tx.query.dpdpObligationTemplate.findMany({ where: inArray(dpdpObligationTemplate.id, templateIds) }) : []
    const byId = new Map(templates.map((t) => [t.id, t]))
    return obligations.map((o) => ({ ...o, template: byId.get(o.templateId)! }))
  })
}
async function membershipFor(orgId: string, identityId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpMembership.findFirst({ where: and(eq(dpdpMembership.identityId, identityId), eq(dpdpMembership.orgId, orgId)) }))
}
async function obligationById(orgId: string, obligationId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, obligationId) }))
}
function fromArea(t: { appliesWhen: unknown }): boolean {
  return !!(t.appliesWhen as { fromArea?: boolean } | null)?.fromArea
}
function openUnassigned(page: Page, except: string[] = []): Row {
  const row = page.rows.find((r) => !r.by && !r.yes && !r.na && !r.isGroup && !r.dependsOnObligationId && !except.includes(r.id))
  expect(row).toBeDefined()
  return row!
}

d("WO-DPDP-011 Step 3: owner RPCs", () => {
  test("areas_for_product is areasForProduct(): same areas, jobs, order and group flags, for both products", async () => {
    const who = await seedIdentity(`areas-${crypto.randomUUID().slice(0, 8)}`)
    for (const product of ["firm", "institution"] as const) {
      const fromRpc = await areasFor(who.email, product)
      const fromTs = await areasForProduct(product)
      expect(fromTs.length).toBeGreaterThan(0)
      expect(fromRpc).toEqual(fromTs)
      expect(fromRpc.some((a) => a.isGroup)).toBe(true)
      expect(fromRpc.some((a) => ["OWNER", "CAMGR", "CAPARTNER"].includes(a.area))).toBe(false)
    }
  }, 60_000)

  test("owner first visit: a person area, a group area, an n/a area, the fromArea auto-close, first_visit_seen_at, and the chain still verifies", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    // None of these four addresses exist yet: the RPC must create identity +
    // membership for each. The person address is passed upper-cased and
    // padded to prove lower(trim()) is applied; one group address is listed
    // twice to prove the group is deduplicated.
    const goEmail = `wo011-s3-go-${suffix}@example.test`
    const personEmail = `wo011-s3-person-${suffix}@example.test`
    const g1 = `wo011-s3-g1-${suffix}@example.test`
    const g2 = `wo011-s3-g2-${suffix}@example.test`

    const result = await completeFirstVisit(owner.email, org.id, [
      { area: GO, emails: [goEmail], na: false },
      { area: "Customer data", emails: [`  ${personEmail.toUpperCase()}  `], na: false },
      { area: "All staff", emails: [g1, g2, g1], na: false },
      { area: "CCTV", emails: [], na: true },
      { area: "Payroll firm", emails: [], na: false }, // no email, not n/a -> skipped, as in the TS
    ])
    expect(result).toEqual({ ok: true, assigned: 3, notApplicable: 1 })

    const all = await obligationsWithTemplates(org.id)
    const byArea = (area: string) => all.filter((o) => o.template.roleTag === area)

    // Person area: every "Customer data" job now names that identity, still open.
    const personId = await identityIdFor(personEmail)
    expect(personId).toBeTruthy()
    const personRows = byArea("Customer data")
    expect(personRows.length).toBeGreaterThan(0)
    for (const o of personRows) {
      expect(o.assignedPersonId).toBe(personId)
      expect(o.state).toBe("open")
    }

    // Every named person got a membership in THIS org (the row that lets them sign in).
    for (const e of [goEmail, personEmail, g1, g2]) {
      const id = await identityIdFor(e)
      expect(id).toBeTruthy()
      const m = await membershipFor(org.id, id!)
      expect(m).toBeDefined()
      expect(m!.level).toBe("staff")
      expect(m!.joinedVia).toBe("named_in_role")
      expect(m!.state).toBe("active")
    }

    // GO area: the fromArea job ("Name the Grievance Officer") auto-closed,
    // credited to the OWNER; the GO's other jobs are assigned and open.
    const goId = await identityIdFor(goEmail)
    const goRows = byArea(GO)
    expect(goRows.length).toBeGreaterThan(1)
    const named = goRows.filter((o) => fromArea(o.template))
    expect(named).toHaveLength(1)
    expect(named[0].state).toBe("closed")
    expect(named[0].closedBy).toBe(owner.identityId)
    expect(named[0].closedAt).not.toBeNull()
    expect(named[0].progressDone).toBe(named[0].progressTotal)
    expect(named[0].assignedPersonId).toBe(goId)
    for (const o of goRows.filter((o) => !fromArea(o.template))) {
      expect(o.assignedPersonId).toBe(goId)
      expect(o.state).toBe("open")
    }

    // Group area: one staff_group, two members (g1 listed twice -> one row),
    // every "All staff" job assigned to it with progress_total = 2.
    const group = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpStaffGroup.findFirst({ where: and(eq(dpdpStaffGroup.orgId, org.id), eq(dpdpStaffGroup.label, "All staff")) }))
    expect(group).toBeDefined()
    const members = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpStaffGroupMember.findMany({ where: eq(dpdpStaffGroupMember.groupId, group!.id) }))
    expect(members).toHaveLength(2)
    const memberMembershipIds = new Set(members.map((m) => m.membershipId))
    for (const e of [g1, g2]) {
      const m = await membershipFor(org.id, (await identityIdFor(e))!)
      expect(memberMembershipIds.has(m!.id)).toBe(true)
    }
    const groupRows = byArea("All staff")
    expect(groupRows.length).toBeGreaterThan(0)
    for (const o of groupRows) {
      expect(o.assignedStaffGroupId).toBe(group!.id)
      expect(o.progressTotal).toBe(2)
      expect(o.assignedPersonId).toBeNull()
    }

    // N/A area, with the TS's exact reason text.
    const naRows = byArea("CCTV")
    expect(naRows.length).toBeGreaterThan(0)
    for (const o of naRows) {
      expect(o.state).toBe("not_applicable")
      expect(o.naReason).toBe(NA_AT_FIRST_VISIT)
    }
    // The skipped area is untouched.
    for (const o of byArea("Payroll firm")) {
      expect(o.assignedPersonId).toBeNull()
      expect(o.state).toBe("open")
    }

    // first_visit_seen_at stamped on the OWNER's membership -- persisted, and
    // visible through the page the app actually reads.
    const ownerMembership = await membershipFor(org.id, owner.identityId)
    expect(ownerMembership!.firstVisitSeenAt).not.toBeNull()
    const page = await myPage(owner.email)
    expect(page.viewer.firstVisitSeenAt).toBeTruthy()
    expect(page.rows.filter((r) => r.by === personEmail).length).toBe(personRows.length)
    const groupOnPage = page.rows.find((r) => r.id === groupRows[0].id)
    expect(groupOnPage?.isGroup).toBe(true)
    expect(groupOnPage?.by).toBe("All staff")
    expect(groupOnPage?.groupTotal).toBe(2)
    expect(page.rows.find((r) => r.id === naRows[0].id)?.na).toBe(true)
    expect(page.rows.find((r) => r.id === named[0].id)?.yes).toBe(true)

    // The proof that four events appended inside one plpgsql loop still form
    // a chain JS can re-verify, on top of the TS-written events already
    // there (organisation_created, obligation_assigned).
    const chain = await verifyDpdpEventChain(org.id)
    expect(chain.ok).toBe(true)
    expect(chain.checked).toBeGreaterThanOrEqual(6)

    // The same kinds/summaries the TS writes, newest first.
    const h = await history(owner.email, org.id, null)
    const summaries = h.map((x) => x.summary)
    expect(summaries).toContain(`Named ${goEmail} as ${GO}`)
    expect(summaries).toContain(`Named ${personEmail} as Customer data`)
    expect(summaries).toContain(`Named 2 people to "All staff"`)
    expect(summaries).toContain(`Marked "CCTV" as not applicable`)
    expect(h.find((x) => x.summary === `Marked "CCTV" as not applicable`)?.kind).toBe("obligation_not_my_job")
    expect(h.find((x) => x.summary.startsWith("Named "))?.kind).toBe("membership_named_in_role")
    expect(h[0].summary).toBe(`Marked "CCTV" as not applicable`)
    // The four newest are this call's; the older two are the TS-seeded
    // organisation_created / "jobs opened" events with their own labels.
    for (const x of h.slice(0, 4)) expect(x.actorLabel).toBe(owner.email)
    expect(h.length).toBe(chain.checked)
  }, 60_000)

  test("assign_person creates the missing membership (WO-011 §4 regression), is idempotent, and refuses closed / n/a jobs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const page = await myPage(owner.email)
    const target = openUnassigned(page)
    const named = `wo011-s3-named-${suffix}@example.test` // never seeded

    expect((await assignPerson(owner.email, target.id, named)).ok).toBe(true)

    const namedId = await identityIdFor(named)
    expect(namedId).toBeTruthy()
    // THE regression assertion: the TS assignObligation() never wrote this row.
    const membership = await membershipFor(org.id, namedId!)
    expect(membership).toBeDefined()
    expect(membership!.level).toBe("staff")
    expect(membership!.joinedVia).toBe("named_in_role")
    expect(membership!.state).toBe("active")
    const updated = await obligationById(org.id, target.id)
    expect(updated?.assignedPersonId).toBe(namedId)
    expect(updated?.state).toBe("open")

    // ...and therefore the named person can actually sign in and see the job.
    const theirs = await myPage(named)
    expect(theirs.org.id).toBe(org.id)
    // Their kind is detected from the job's own roleTag (e.g. "go" when the
    // named job is the Grievance Officer's), never "owner".
    expect(theirs.viewer.kind).not.toBe("owner")
    expect(theirs.rows.find((r) => r.id === target.id)?.by).toBe(named)

    // Naming the same address again (different case) reuses identity and
    // membership rather than duplicating either.
    const second = openUnassigned(page, [target.id])
    expect((await assignPerson(owner.email, second.id, named.toUpperCase())).ok).toBe(true)
    const memberships = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpMembership.findMany({ where: and(eq(dpdpMembership.identityId, namedId!), eq(dpdpMembership.orgId, org.id)) }))
    expect(memberships).toHaveLength(1)
    const identities = await db.query.dpdpIdentity.findMany({ where: eq(dpdpIdentity.primaryEmail, named) })
    expect(identities).toHaveLength(1)
    expect((await obligationById(org.id, second.id))?.assignedPersonId).toBe(namedId)

    const h = await history(owner.email, org.id, null)
    expect(h[0].kind).toBe("obligation_assigned")
    expect(h[0].summary).toBe(`Assigned "${second.what}" to ${named}`)
    expect(h.map((x) => x.summary)).toContain(`Assigned "${target.what}" to ${named}`)

    // Closed and n/a jobs are refused with the TS's own 409 messages.
    // Manual try/catch, not expect().rejects -- see dpdp-group-answer.test.ts
    // for the bun 1.3.14 matcher hang this avoids.
    const toClose = openUnassigned(page, [target.id, second.id])
    expect((await markDone(owner.email, toClose.id)).ok).toBe(true)
    let msg = ""
    try { await assignPerson(owner.email, toClose.id, named) } catch (e) { msg = message(e) }
    expect(msg).toContain("Already closed")
    const toNa = openUnassigned(page, [target.id, second.id, toClose.id])
    expect((await markNotApplicable(owner.email, toNa.id, null)).ok).toBe(true)
    msg = ""
    try { await assignPerson(owner.email, toNa.id, named) } catch (e) { msg = message(e) }
    expect(msg).toContain("Doesn't apply")
    msg = ""
    try { await assignPerson(owner.email, openUnassigned(page, [target.id, second.id, toClose.id, toNa.id]).id, "   ") } catch (e) { msg = message(e) }
    expect(msg).toContain("An email address is required")

    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 60_000)

  test("a staff member is refused the owner-only RPCs; mark_not_applicable is owner-or-assignee with the reason trimmed/defaulted", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const page = await myPage(owner.email)
    const mine = openUnassigned(page)
    const theirs = openUnassigned(page, [mine.id])
    const staffEmail = `wo011-s3-staff-${suffix}@example.test`
    expect((await assignPerson(owner.email, mine.id, staffEmail)).ok).toBe(true)

    let msg = ""
    try { await completeFirstVisit(staffEmail, org.id, [{ area: "CCTV", emails: [], na: true }]) } catch (e) { msg = message(e) }
    expect(msg).toContain("Only the owner can do this")
    msg = ""
    try { await assignPerson(staffEmail, theirs.id, "someone@example.test") } catch (e) { msg = message(e) }
    expect(msg).toContain("Only the owner can do this")
    // Neither refusal wrote anything.
    expect((await obligationById(org.id, theirs.id))?.assignedPersonId).toBeNull()
    expect((await membershipFor(org.id, (await identityIdFor(staffEmail))!))?.firstVisitSeenAt).toBeNull()
    expect(await identityIdFor("someone@example.test")).toBeNull()

    // Someone else's job: refused. Their own: allowed, reason trimmed.
    msg = ""
    try { await markNotApplicable(staffEmail, theirs.id, "not us") } catch (e) { msg = message(e) }
    expect(msg).toContain("Not your job")
    expect((await obligationById(org.id, theirs.id))?.state).toBe("open")
    expect((await markNotApplicable(staffEmail, mine.id, "  we have no cameras  ")).ok).toBe(true)
    const own = await obligationById(org.id, mine.id)
    expect(own?.state).toBe("not_applicable")
    expect(own?.naReason).toBe("we have no cameras")

    // The owner may mark any job; an empty reason falls back to the default text.
    expect((await markNotApplicable(owner.email, theirs.id, "   ")).ok).toBe(true)
    const ownerMarked = await obligationById(org.id, theirs.id)
    expect(ownerMarked?.state).toBe("not_applicable")
    expect(ownerMarked?.naReason).toBe(NA_DEFAULT)

    const h = await history(owner.email, org.id, null)
    expect(h[0].kind).toBe("obligation_not_my_job")
    expect(h[0].summary).toBe(`Marked "${theirs.what}" as not applicable`)
    expect(h[0].detail).toBeNull()
    const staffEvent = h.find((x) => x.summary === `Marked "${mine.what}" as not applicable`)
    expect(staffEvent?.actorLabel).toBe(staffEmail)
    expect(staffEvent?.detail).toBe("we have no cameras")
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 60_000)

  test("cross-tenant: an owner of org A cannot touch org B through any of the new RPCs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`a-${suffix}`)
    const b = await buildOrg(`b-${suffix}`)
    const pageB = await myPage(b.owner.email)
    const bJob = openUnassigned(pageB)

    let msg = ""
    try { await assignPerson(a.owner.email, bJob.id, `wo011-s3-intruder-${suffix}@example.test`) } catch (e) { msg = message(e) }
    expect(msg).toContain("Job not found")
    msg = ""
    try { await markNotApplicable(a.owner.email, bJob.id, "mine now") } catch (e) { msg = message(e) }
    expect(msg).toContain("Job not found")
    msg = ""
    try { await completeFirstVisit(a.owner.email, b.org.id, [{ area: "CCTV", emails: [], na: true }]) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await history(a.owner.email, b.org.id, null) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")

    // Org B is exactly as it was: nothing assigned, nothing marked, no
    // membership minted for the intruder's email, no first visit stamped,
    // and only the two TS-written events in its chain.
    const untouched = await obligationById(b.org.id, bJob.id)
    expect(untouched?.assignedPersonId).toBeNull()
    expect(untouched?.state).toBe("open")
    expect(await identityIdFor(`wo011-s3-intruder-${suffix}@example.test`)).toBeNull()
    expect((await membershipFor(b.org.id, b.owner.identityId))?.firstVisitSeenAt).toBeNull()
    const chainB = await verifyDpdpEventChain(b.org.id)
    expect(chainB.ok).toBe(true)
    expect(chainB.checked).toBe(2)
    // And org A's owner still works normally against org A.
    expect((await completeFirstVisit(a.owner.email, a.org.id, [{ area: "CCTV", emails: [], na: true }])).notApplicable).toBe(1)
  }, 60_000)

  test("history is newest-first, capped, defaults to the caller's newest org, and carries what the Timeline needs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    await completeFirstVisit(owner.email, org.id, [
      { area: "CCTV", emails: [], na: true },
      { area: "Website firm", emails: [], na: true },
      { area: "Payroll firm", emails: [], na: true },
      { area: "Group company", emails: [], na: true },
    ])
    const total = (await verifyDpdpEventChain(org.id)).checked
    expect(total).toBeGreaterThanOrEqual(6)

    const three = await history(owner.email, org.id, 3)
    expect(three).toHaveLength(3)
    for (let i = 1; i < three.length; i++) {
      expect(new Date(three[i - 1].occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(three[i].occurredAt).getTime())
    }
    expect(three[0].summary).toBe(`Marked "Group company" as not applicable`)
    for (const x of three) {
      expect(typeof x.id).toBe("string")
      expect(typeof x.kind).toBe("string")
      expect(typeof x.summary).toBe("string")
      expect(x.detail === null || typeof x.detail === "string").toBe(true)
      expect(x.actorLabel).toBe(owner.email)
      expect(x.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    }
    // Default org (the caller's newest membership) and default limit.
    const byDefault = await history(owner.email, null, null)
    expect(byDefault.length).toBe(Math.min(total, 15))
    expect(byDefault[0].id).toBe(three[0].id)
    // The cap: never more than 50, never more than exist.
    const big = await history(owner.email, org.id, 500)
    expect(big.length).toBe(Math.min(total, 50))
    // The floor: 0 / negative is clamped to 1, not an empty page or an error.
    expect(await history(owner.email, org.id, 0)).toHaveLength(1)
  }, 60_000)

  test("no claims at all is refused by every new write and read, not silently empty", async () => {
    let msg = ""
    try { await sql`select public.dpdp_complete_owner_first_visit('no-such-org', '[]'::jsonb)` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await sql`select public.dpdp_assign_person('no-such-job', 'x@example.test')` } catch (e) { msg = message(e) }
    expect(msg).toContain("Job not found")
    msg = ""
    try { await sql`select public.dpdp_mark_not_applicable('no-such-job', null)` } catch (e) { msg = message(e) }
    expect(msg).toContain("Job not found")
    msg = ""
    try { await sql`select public.dpdp_org_history()` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
  }, 30_000)
})
