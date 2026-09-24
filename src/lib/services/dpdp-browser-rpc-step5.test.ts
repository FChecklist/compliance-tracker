/// <reference types="bun-types" />
// WO-DPDP-011 Step 5: the remaining WO-010 flows as browser RPCs
// (drizzle/0609) exercised over the real database, the same way
// dpdp-browser-rpc.test.ts / -step3.test.ts exercise Steps 2 and 3 -- a
// Supabase Auth JWT is stood in for by the request.jwt.claims GUC that
// auth.jwt() reads. Load-bearing assertions:
//   * dpdp_answer_group persists each member's PRIVATE answer, rolls
//     progress_done up as "how many answered" (not "how many said done"),
//     closes the job once everyone has answered (the 0606 rule), and
//     refuses a non-member of the group -- all re-read from the rows and
//     from dpdp_my_page, never from the success payload alone.
//   * dpdp_my_clients lists EXACTLY the orgs where the caller is named on a
//     live CAPARTNER/CAMGR job (the TS listCaClientOrgs rule), with the
//     right caSub, done/total, and in membership order; an owner who is not
//     a CA anywhere gets [].
//   * dpdp_create_client_org instantiates the library's own count of jobs
//     for each product (compared against listObligationTemplates, not a
//     hard-coded 31/28), wires depends_on, makes the caller the CA partner
//     (dpdp_my_page reports caSub 'partner'; dpdp_my_clients lists it), and
//     gives the named owner an ACTIVE owner membership that lands on the
//     "looks right -- confirm" review (dpdp_org_setup /
//     dpdp_owner_confirm_setup).
//   * dpdp_parent_consent: Yes AND No both persist as consent_record rows
//     (No = granted:false + withdrawn_at, the TS shape), a second use is
//     refused with nothing changed, an unknown/expired token is a reason
//     not an error -- all with NO claims set, as the anon key would call it.
//   * Cross-tenant: none of the new RPCs reaches another org.
//
// Every RPC call runs inside ONE transaction with a transaction-local
// set_config -- exactly what PostgREST does per request. DATABASE_URL goes
// through Supabase's transaction-mode pooler (port 6543), which hands
// consecutive statements to different backends, so session-level state is
// simply gone by the next statement (found live while writing the Step 2
// test; see its header). Manual try/catch rather than expect().rejects --
// see dpdp-group-answer.test.ts for the bun 1.3.14 matcher hang it avoids.
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
const { getCurrentLibraryVersion, listObligationTemplates } = await import("./dpdp-obligation-library")
const { verifyDpdpEventChain } = await import("./dpdp-event-service")
const {
  db, dpdpIdentity, dpdpIdentityEmail, dpdpMembership, dpdpObligation, dpdpObligationTemplate, dpdpOrganisation,
  dpdpPrincipalGroup, dpdpNoticeVersion, dpdpConsentCampaign, dpdpConsentToken, dpdpConsentRecord,
} = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { and, eq, inArray } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

type Row = { id: string; what: string; by: string | null; isGroup: boolean; groupDone?: number; groupTotal?: number; viewerIsGroupMember?: boolean; myGroupAnswer?: string | null; yes: boolean; na: boolean; dependsOnObligationId: string | null }
type Page = { org: { id: string; product: string }; viewer: { email: string; kind: string; caSub: string | null; firstVisitSeenAt: string | null }; rows: Row[] }
type Assignment = { area: string; emails: string[]; na: boolean }
type GroupAnswerResult = { ok: boolean; answered: number; total: number; closed: boolean }
type Client = { org: { id: string; name: string; product: string }; caSub: "partner" | "manager"; done: number; total: number; whereItIs: string; dataLocations: number; ownerConfirmedAt: string | null; setUpByMe: boolean }
type CreateClientResult = { ok: boolean; orgId: string; slug: string; jobs: number; ownerMembershipId: string | null }
type OrgSetup = { orgId: string; setUpBy: { membershipId: string; email: string | null } | null; ownerConfirmedAt: string | null }
type ConfirmResult = { ok: boolean; alreadyConfirmed: boolean }
type ConsentPreview = { ok: boolean; reason?: string; orgName?: string; notice?: { docKind: string; version: string } | null; openedAt?: string | null; actedAt?: string | null; alreadyAnswered?: boolean }
type ConsentResult = { ok: boolean; reason?: string; answer?: string }
type HistoryEntry = { id: string; kind: string; summary: string; detail: string | null; actorLabel: string; occurredAt: string }

/** One request, as PostgREST would run it: a transaction whose claims die with it. */
async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
async function myPage(email: string, orgId: string | null = null): Promise<Page> {
  return asEmail(email, async (tx) => {
    const [{ page }] = await tx<{ page: Page }[]>`select public.dpdp_my_page(${orgId}) as page`
    return page
  })
}
async function markDone(email: string, obligationId: string): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_mark_done(${obligationId}) as result`
    return result
  })
}
async function completeFirstVisit(email: string, orgId: string, assignments: Assignment[]) {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_complete_owner_first_visit(${orgId}, ${tx.json(assignments)}) as result`
    return result
  })
}
async function assignPerson(email: string, obligationId: string, address: string): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_assign_person(${obligationId}, ${address}) as result`
    return result
  })
}
async function markNotApplicable(email: string, obligationId: string): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: { ok: boolean } }[]>`select public.dpdp_mark_not_applicable(${obligationId}, null) as result`
    return result
  })
}
async function history(email: string, orgId: string | null, limit: number | null): Promise<HistoryEntry[]> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: HistoryEntry[] }[]>`select public.dpdp_org_history(${orgId}, ${limit}::int) as result`
    return result
  })
}
// --- the Step 5 functions ---
async function answerGroup(email: string, obligationId: string, answer: string): Promise<GroupAnswerResult> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: GroupAnswerResult }[]>`select public.dpdp_answer_group(${obligationId}, ${answer}) as result`
    return result
  })
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
async function orgSetup(email: string, orgId: string | null): Promise<OrgSetup> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: OrgSetup }[]>`select public.dpdp_org_setup(${orgId}) as result`
    return result
  })
}
async function ownerConfirm(email: string, orgId: string | null): Promise<ConfirmResult> {
  return asEmail(email, async (tx) => {
    const [{ result }] = await tx<{ result: ConfirmResult }[]>`select public.dpdp_owner_confirm_setup(${orgId}) as result`
    return result
  })
}
// No claims at all: exactly how the anon key reaches these two.
async function consentPreview(token: string): Promise<ConsentPreview> {
  const [{ result }] = await sql<{ result: ConsentPreview }[]>`select public.dpdp_parent_consent_preview(${token}) as result`
  return result
}
async function parentConsent(token: string, answer: string): Promise<ConsentResult> {
  const [{ result }] = await sql<{ result: ConsentResult }[]>`select public.dpdp_parent_consent(${token}, ${answer}) as result`
  return result
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function seedIdentity(suffix: string) {
  const email = `wo011-s5-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

async function buildOrg(suffix: string, product: "firm" | "institution" = "firm") {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO011 S5 ${suffix}`, product })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  return { owner, org }
}

// identity_email carries no RLS (0604's header), so the plain client sees
// every row; lower() because the RPCs store lowercased addresses.
async function identityIdFor(email: string): Promise<string | null> {
  const row = await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, email.trim().toLowerCase()) })
  return row?.identityId ?? null
}
// Under the org's tenant context: dpdp.obligation & co are RLS-scoped to
// current_org_id() and silently return nothing without it.
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
async function organisationById(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, orgId) }))
}
function openUnassigned(page: Page, except: string[] = []): Row {
  const row = page.rows.find((r) => !r.by && !r.yes && !r.na && !r.isGroup && !r.dependsOnObligationId && !except.includes(r.id))
  expect(row).toBeDefined()
  return row!
}
async function jobTagged(orgId: string, roleTag: string) {
  const all = await obligationsWithTemplates(orgId)
  const job = all.find((o) => o.template.roleTag === roleTag && o.state === "open")
  expect(job, `no open ${roleTag} job in ${orgId}`).toBeDefined()
  return job!
}

d("WO-DPDP-011 Step 5: group answers", () => {
  test("three answers roll up as 'how many answered', close when everyone has, and a non-member is refused", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const g1 = `wo011-s5-g1-${suffix}@example.test`
    const g2 = `wo011-s5-g2-${suffix}@example.test`
    await completeFirstVisit(owner.email, org.id, [{ area: "All staff", emails: [g1, g2], na: false }])

    const all = await obligationsWithTemplates(org.id)
    const groupJobs = all.filter((o) => o.assignedStaffGroupId)
    expect(groupJobs.length).toBeGreaterThan(0)
    const target = groupJobs.find((o) => !o.dependsOnObligationId) ?? groupJobs[0]
    if (target.dependsOnObligationId) expect((await markDone(owner.email, target.dependsOnObligationId)).ok).toBe(true)
    expect(target.progressTotal).toBe(2)

    // First member: Done. Persisted, visible on THEIR page as their own
    // answer, and the job is still open (1 of 2 answered).
    expect(await answerGroup(g1, target.id, "done")).toEqual({ ok: true, answered: 1, total: 2, closed: false })
    let page1 = await myPage(g1, org.id)
    let row1 = page1.rows.find((r) => r.id === target.id)
    expect(row1?.isGroup).toBe(true)
    expect(row1?.viewerIsGroupMember).toBe(true)
    expect(row1?.myGroupAnswer).toBe("done")
    expect(row1?.groupDone).toBe(1)
    expect(row1?.groupTotal).toBe(2)
    expect(row1?.yes).toBe(false)
    // Changing the answer does not double-count: still 1 of 2.
    expect(await answerGroup(g1, target.id, "cannot")).toEqual({ ok: true, answered: 1, total: 2, closed: false })
    page1 = await myPage(g1, org.id)
    row1 = page1.rows.find((r) => r.id === target.id)
    expect(row1?.myGroupAnswer).toBe("cannot")
    expect(row1?.groupDone).toBe(1)
    expect((await obligationById(org.id, target.id))?.state).toBe("open")
    expect((await obligationById(org.id, target.id))?.progressDone).toBe(1)

    // Refusals, none of which write anything.
    let msg = ""
    try { await answerGroup(owner.email, target.id, "done") } catch (e) { msg = message(e) }
    expect(msg).toContain("You aren't a member of the group this job is assigned to")
    const personJob = openUnassigned(await myPage(owner.email, org.id))
    msg = ""
    try { await answerGroup(g1, personJob.id, "done") } catch (e) { msg = message(e) }
    expect(msg).toContain("This job isn't assigned to a group")
    msg = ""
    try { await answerGroup(g1, target.id, "maybe") } catch (e) { msg = message(e) }
    expect(msg).toContain("That is not an answer this job can record")
    expect((await obligationById(org.id, target.id))?.progressDone).toBe(1)

    // Second member: Doesn't apply to me -- everyone has answered, so the
    // job closes, credited to the last answerer, whatever the answers were.
    expect(await answerGroup(g2, target.id, "never_had_any")).toEqual({ ok: true, answered: 2, total: 2, closed: true })
    const closed = await obligationById(org.id, target.id)
    expect(closed?.state).toBe("closed")
    expect(closed?.progressDone).toBe(2)
    expect(closed?.closedBy).toBe(await identityIdFor(g2))
    expect(closed?.closedAt).not.toBeNull()
    const ownerRow = (await myPage(owner.email, org.id)).rows.find((r) => r.id === target.id)
    expect(ownerRow?.yes).toBe(true)
    expect(ownerRow?.groupDone).toBe(2)

    // The TS's own kinds and summaries, newest first, and the chain verifies.
    const h = await history(owner.email, org.id, null)
    expect(h[0].kind).toBe("task_answered")
    expect(h[0].summary).toBe(`${g2} answered "Doesn't apply to me" for "${target.template.name}" (2 of 2)`)
    expect(h[0].actorLabel).toBe(g2)
    expect(h.find((x) => x.summary === `${g1} answered "I can't" for "${target.template.name}" (1 of 2)`)?.kind).toBe("task_answer_refused")
    expect(h.find((x) => x.summary === `${g1} answered "Done" for "${target.template.name}" (1 of 2)`)?.kind).toBe("task_answered")
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 60_000)
})

d("WO-DPDP-011 Step 5: the CA firm view", () => {
  test("my_clients lists exactly the orgs where the caller is named CA partner/manager, with done/total and stage", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const ca = await seedIdentity(`ca-${suffix}`)
    const a = await buildOrg(`a-${suffix}`)
    const b = await buildOrg(`b-${suffix}`)
    const c = await buildOrg(`c-${suffix}`)

    // An identity nobody has named anywhere: refused, not an empty list.
    let msg = ""
    try { await myClients(`wo011-s5-nobody-${suffix}@example.test`) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    expect(await myClients(ca.email)).toEqual([])

    // Named CA partner in A, CA manager in B (in that order), nothing in C.
    expect((await assignPerson(a.owner.email, (await jobTagged(a.org.id, "CAPARTNER")).id, ca.email)).ok).toBe(true)
    await sleep(25)
    expect((await assignPerson(b.owner.email, (await jobTagged(b.org.id, "CAMGR")).id, ca.email)).ok).toBe(true)
    // ...and a plain staff job in C, which does NOT make C a client.
    expect((await assignPerson(c.owner.email, openUnassigned(await myPage(c.owner.email, c.org.id)).id, ca.email)).ok).toBe(true)

    const list = await myClients(ca.email)
    expect(list.map((x) => x.org.id)).toEqual([a.org.id, b.org.id])
    expect(list[0].caSub).toBe("partner")
    expect(list[1].caSub).toBe("manager")
    const liveA = (await obligationsWithTemplates(a.org.id)).filter((o) => o.state !== "not_applicable").length
    expect(list[0].total).toBe(liveA)
    expect(list[0].done).toBe(0)
    expect(list[0].whereItIs).toBe("Not started")
    expect(list[0].setUpByMe).toBe(false)
    expect(list[0].ownerConfirmedAt).toBeNull()
    expect(typeof list[0].dataLocations).toBe("number")
    expect(list[0].org.name).toBe(a.org.name)
    expect(list[0].org.product).toBe("firm")

    // done counts closed/submitted live jobs, re-read after a real close.
    expect((await markDone(a.owner.email, openUnassigned(await myPage(a.owner.email, a.org.id)).id)).ok).toBe(true)
    const after = await myClients(ca.email)
    expect(after[0].done).toBe(1)
    expect(after[0].total).toBe(liveA)
    expect(after[0].whereItIs).toBe("In progress")

    // The owners are not CAs anywhere: [] each. The CA can open a client's
    // page and is detected as that client's CA there.
    expect(await myClients(a.owner.email)).toEqual([])
    const pageA = await myPage(ca.email, a.org.id)
    expect(pageA.viewer.kind).toBe("ca")
    expect(pageA.viewer.caSub).toBe("partner")
    expect((await myPage(ca.email, b.org.id)).viewer.caSub).toBe("manager")

    // Marking the naming job not-applicable drops the org from the list --
    // "live" means live, exactly as the TS filtered.
    expect((await markNotApplicable(a.owner.email, (await obligationsWithTemplates(a.org.id)).find((o) => o.assignedPersonId === ca.identityId)!.id)).ok).toBe(true)
    expect((await myClients(ca.email)).map((x) => x.org.id)).toEqual([b.org.id])
  }, 60_000)

  test("create_client_org: the library's own job count per product, the CA as partner, the owner on the review screen, and confirm", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const ca = await seedIdentity(`ca2-${suffix}`)
    const version = await getCurrentLibraryVersion()
    const templates = await listObligationTemplates(version.id)
    const forProduct = (p: string) => templates.filter((t) => t.product == null || t.product === p)
    const firmCount = forProduct("firm").length
    const institutionCount = forProduct("institution").length
    expect(firmCount).toBeGreaterThan(0)
    expect(institutionCount).toBeGreaterThan(0)
    expect(firmCount).not.toBe(institutionCount)

    // Holding no membership anywhere: refused, and no org was created.
    let msg = ""
    try { await createClientOrg(ca.email, `WO011 S5 Client ${suffix}`, "firm", null) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    expect(await db.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.name, `WO011 S5 Client ${suffix}`) })).toBeUndefined()

    // The CA firm's own (free) file gives them a membership; now they may.
    await createDpdpOrganisation({ identityId: ca.identityId, name: `WO011 S5 CA firm ${suffix}`, product: "firm" })
    msg = ""
    try { await createClientOrg(ca.email, "   ", "firm", null) } catch (e) { msg = message(e) }
    expect(msg).toContain("An organisation name is required")
    msg = ""
    try { await createClientOrg(ca.email, `WO011 S5 Client ${suffix}`, "shop", null) } catch (e) { msg = message(e) }
    expect(msg).toContain("product must be")

    const ownerEmail = `wo011-s5-client-owner-${suffix}@example.test`
    const res = await createClientOrg(ca.email, `WO011 S5 Client ${suffix}`, "firm", `  ${ownerEmail.toUpperCase()} `)
    expect(res.ok).toBe(true)
    expect(res.jobs).toBe(firmCount)
    expect(res.ownerMembershipId).toBeTruthy()
    expect(res.slug).toBe(`wo011-s5-client-${suffix}`)

    // The jobs: the firm library, every CAPARTNER job on the CA, depends_on
    // wired for every template that names a dependency in this product.
    const jobs = await obligationsWithTemplates(res.orgId)
    expect(jobs).toHaveLength(firmCount)
    const firmKeys = new Set(forProduct("firm").map((t) => t.key))
    const expectedDeps = forProduct("firm").filter((t) => t.dependsOnKey && firmKeys.has(t.dependsOnKey)).length
    expect(expectedDeps).toBeGreaterThan(0)
    expect(jobs.filter((o) => o.dependsOnObligationId).length).toBe(expectedDeps)
    for (const o of jobs.filter((o) => o.dependsOnObligationId)) {
      const dep = jobs.find((x) => x.id === o.dependsOnObligationId)
      expect(dep?.template.key).toBe(o.template.dependsOnKey)
    }
    const partnerJobs = jobs.filter((o) => o.template.roleTag === "CAPARTNER")
    expect(partnerJobs.length).toBeGreaterThan(0)
    for (const o of partnerJobs) expect(o.assignedPersonId).toBe(ca.identityId)
    for (const o of jobs.filter((o) => o.template.roleTag !== "CAPARTNER")) expect(o.assignedPersonId).toBeNull()

    // The org itself: product, set_up_by = the CA's new membership, owner unconfirmed.
    const org = await organisationById(res.orgId)
    expect(org?.product).toBe("firm")
    const caMembership = await membershipFor(res.orgId, ca.identityId)
    expect(caMembership?.level).toBe("staff")
    expect(caMembership?.joinedVia).toBe("created")
    expect(org?.setUpByMembershipId).toBe(caMembership!.id)
    expect(org?.ownerConfirmedAt).toBeNull()

    // The CA can open it and is its CA partner; it is on their client list,
    // waiting for the owner.
    const caPage = await myPage(ca.email, res.orgId)
    expect(caPage.org.id).toBe(res.orgId)
    expect(caPage.viewer.kind).toBe("ca")
    expect(caPage.viewer.caSub).toBe("partner")
    expect(caPage.rows).toHaveLength(firmCount)
    const mine = (await myClients(ca.email)).find((x) => x.org.id === res.orgId)
    expect(mine?.caSub).toBe("partner")
    expect(mine?.setUpByMe).toBe(true)
    expect(mine?.whereItIs).toBe("Waiting for the owner to confirm")

    // The owner: identity + ACTIVE owner membership (lowercased email), can
    // sign, sees the org as owner with no first visit yet, and the setup
    // read names the CA.
    const ownerId = await identityIdFor(ownerEmail)
    expect(ownerId).toBeTruthy()
    const ownerMembership = await membershipFor(res.orgId, ownerId!)
    expect(ownerMembership?.id).toBe(res.ownerMembershipId!)
    expect(ownerMembership?.level).toBe("owner")
    expect(ownerMembership?.joinedVia).toBe("invited")
    expect(ownerMembership?.state).toBe("active")
    expect(ownerMembership?.canSign).toBe(true)
    const ownerPage = await myPage(ownerEmail, res.orgId)
    expect(ownerPage.viewer.kind).toBe("owner")
    expect(ownerPage.viewer.firstVisitSeenAt).toBeNull()
    const setup = await orgSetup(ownerEmail, res.orgId)
    expect(setup.setUpBy?.email).toBe(ca.email)
    expect(setup.setUpBy?.membershipId).toBe(caMembership!.id)
    expect(setup.ownerConfirmedAt).toBeNull()

    // Only the owner may confirm; the CA (staff there) is refused.
    msg = ""
    try { await ownerConfirm(ca.email, res.orgId) } catch (e) { msg = message(e) }
    expect(msg).toContain("Only the owner can do this")
    expect(await ownerConfirm(ownerEmail, res.orgId)).toEqual({ ok: true, alreadyConfirmed: false })
    expect(await ownerConfirm(ownerEmail, res.orgId)).toEqual({ ok: true, alreadyConfirmed: true })
    expect((await orgSetup(ownerEmail, res.orgId)).ownerConfirmedAt).not.toBeNull()
    expect((await organisationById(res.orgId))?.ownerConfirmedAt).not.toBeNull()
    expect((await myPage(ownerEmail, res.orgId)).viewer.firstVisitSeenAt).toBeTruthy()
    expect((await myClients(ca.email)).find((x) => x.org.id === res.orgId)?.whereItIs).toBe("Not started")

    // An org its owner set up has nothing to confirm.
    const own = await buildOrg(`own-${suffix}`)
    expect((await orgSetup(own.owner.email, own.org.id)).setUpBy).toBeNull()
    msg = ""
    try { await ownerConfirm(own.owner.email, own.org.id) } catch (e) { msg = message(e) }
    expect(msg).toContain("Nothing to confirm")

    // The other product, no owner named, and a slug that stays unique.
    const school = await createClientOrg(ca.email, `WO011 S5 Client ${suffix}`, "institution", null)
    expect(school.jobs).toBe(institutionCount)
    expect(school.ownerMembershipId).toBeNull()
    expect(school.slug).toBe(`wo011-s5-client-${suffix}-2`)
    expect((await obligationsWithTemplates(school.orgId)).every((o) => o.template.product === "institution")).toBe(true)
    expect((await myPage(ca.email, school.orgId)).org.product).toBe("institution")

    // Events: the TS's own kinds/summaries, and the chain verifies.
    const h = await history(ca.email, res.orgId, null)
    const kinds = h.map((x) => x.kind)
    expect(kinds).toContain("organisation_created")
    expect(kinds).toContain("obligation_assigned")
    expect(kinds).toContain("organisation_owner_confirmed")
    expect(h.map((x) => x.summary)).toContain(`Organisation "WO011 S5 Client ${suffix}" created`)
    expect(h.map((x) => x.summary)).toContain(`${firmCount} jobs opened from library ${version.version}`)
    expect(h.find((x) => x.kind === "obligation_assigned")?.actorLabel).toBe("system")
    expect(h.map((x) => x.summary)).toContain(`Named ${ca.email} as CA partner`)
    expect(h.map((x) => x.summary)).toContain(`Named ${ownerEmail} as owner`)
    expect((await verifyDpdpEventChain(res.orgId)).ok).toBe(true)
  }, 90_000)
})

d("WO-DPDP-011 Step 5: parent consent (token is the credential, no claims)", () => {
  test("Yes and No both persist, a second use is refused, unknown/expired tokens are a reason not an error", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(`p-${suffix}`)
    const yesTok = `wo011-s5-yes-${crypto.randomUUID()}`
    const noTok = `wo011-s5-no-${crypto.randomUUID()}`
    const oldTok = `wo011-s5-old-${crypto.randomUUID()}`
    const year = new Date(Date.now() + 365 * 86400000)
    const { tokenIds, noticeId } = await withDpdpContext({ orgId: org.id }, async (tx) => {
      const [group] = await tx.insert(dpdpPrincipalGroup).values({ orgId: org.id, label: "Parents" }).returning()
      const [notice] = await tx.insert(dpdpNoticeVersion).values({ orgId: org.id, docKind: "privacy", version: "1.0", releasedOn: "2026-09-22", effectiveFrom: new Date(), languages: ["en"], state: "live" }).returning()
      const [campaign] = await tx.insert(dpdpConsentCampaign).values({ orgId: org.id, groupId: group.id, noticeVersionId: notice.id, sentAt: new Date() }).returning()
      const rows = await tx.insert(dpdpConsentToken).values([
        { campaignId: campaign.id, token: yesTok, contactHash: "hash-yes", expiresAt: year },
        { campaignId: campaign.id, token: noTok, contactHash: "hash-no", expiresAt: year },
        { campaignId: campaign.id, token: oldTok, contactHash: "hash-old", expiresAt: new Date(Date.now() - 86400000) },
      ]).returning()
      return { tokenIds: Object.fromEntries(rows.map((r) => [r.token, r.id])), noticeId: notice.id }
    })
    const tokenRow = (token: string) => withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpConsentToken.findFirst({ where: eq(dpdpConsentToken.token, token) }))
    const records = (token: string) => withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpConsentRecord.findMany({ where: eq(dpdpConsentRecord.tokenId, tokenIds[token]) }))

    // Opening the link: the notice and the org, nothing answered, opened_at stamped (the TS's own behaviour).
    const preview = await consentPreview(yesTok)
    expect(preview.ok).toBe(true)
    expect(preview.orgName).toBe(org.name)
    expect(preview.notice).toEqual(expect.objectContaining({ docKind: "privacy", version: "1.0" }))
    expect(preview.alreadyAnswered).toBe(false)
    expect(preview.actedAt).toBeNull()
    expect((await tokenRow(yesTok))?.openedAt).not.toBeNull()
    expect((await tokenRow(yesTok))?.actedAt).toBeNull()
    expect(await records(yesTok)).toHaveLength(0)
    expect(await consentPreview("wo011-s5-not-a-token")).toEqual({ ok: false, reason: "This link is not valid or has expired" })
    expect(await consentPreview(oldTok)).toEqual({ ok: false, reason: "This link is not valid or has expired" })
    expect((await parentConsent(oldTok, "yes")).ok).toBe(false)
    expect((await tokenRow(oldTok))?.actedAt).toBeNull()

    // Not an answer: refused, nothing written.
    expect(await parentConsent(yesTok, "maybe")).toEqual({ ok: false, reason: "That is not an answer this link can record." })
    expect(await records(yesTok)).toHaveLength(0)

    // Yes.
    expect(await parentConsent(yesTok, "yes")).toEqual({ ok: true, answer: "yes" })
    const yesRecords = await records(yesTok)
    expect(yesRecords).toHaveLength(1)
    expect(yesRecords[0].granted).toBe(true)
    expect(yesRecords[0].withdrawnAt).toBeNull()
    expect(yesRecords[0].purposeKey).toBe("consent")
    expect(yesRecords[0].noticeVersionId).toBe(noticeId)
    expect(yesRecords[0].language).toBe("en")
    expect((await tokenRow(yesTok))?.actedAt).not.toBeNull()
    // Single use: pressing again changes nothing.
    expect(await parentConsent(yesTok, "no")).toEqual({ ok: false, reason: "This link has already been used. Nothing has changed." })
    expect(await records(yesTok)).toHaveLength(1)
    expect((await consentPreview(yesTok)).alreadyAnswered).toBe(true)

    // No is a valid answer: recorded as a row of its own, never a missing row.
    expect(await parentConsent(noTok, "no")).toEqual({ ok: true, answer: "no" })
    const noRecords = await records(noTok)
    expect(noRecords).toHaveLength(1)
    expect(noRecords[0].granted).toBe(false)
    expect(noRecords[0].withdrawnAt).not.toBeNull()
    expect((await tokenRow(noTok))?.actedAt).not.toBeNull()
    expect((await tokenRow(noTok))?.openedAt).not.toBeNull()
    expect((await parentConsent(noTok, "yes")).ok).toBe(false)

    // Two consent_recorded events with the TS's own label and no identity; chain intact.
    const h = await history(owner.email, org.id, null)
    const consents = h.filter((x) => x.kind === "consent_recorded")
    expect(consents).toHaveLength(2)
    for (const x of consents) {
      expect(x.summary).toBe("Recorded 1 answer(s)")
      expect(x.actorLabel).toBe("A person on a link")
    }
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 60_000)
})

d("WO-DPDP-011 Step 5: cross-tenant and no-claims refusals", () => {
  test("an owner of org A cannot touch org B through any of the new RPCs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`xa-${suffix}`)
    const b = await buildOrg(`xb-${suffix}`)
    const g = `wo011-s5-xg-${suffix}@example.test`
    await completeFirstVisit(b.owner.email, b.org.id, [{ area: "All staff", emails: [g], na: false }])
    const bGroupJob = (await obligationsWithTemplates(b.org.id)).find((o) => o.assignedStaffGroupId)!
    expect(bGroupJob).toBeDefined()

    let msg = ""
    try { await answerGroup(a.owner.email, bGroupJob.id, "done") } catch (e) { msg = message(e) }
    expect(msg).toContain("Job not found")
    msg = ""
    try { await orgSetup(a.owner.email, b.org.id) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await ownerConfirm(a.owner.email, b.org.id) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    // A's refusals wrote nothing: B's group job is still unanswered, and
    // B's own member can then answer it normally (a 1-person group closes
    // on the first answer).
    expect((await obligationById(b.org.id, bGroupJob.id))?.progressDone).toBe(0)
    expect((await myClients(a.owner.email)).map((x) => x.org.id)).not.toContain(b.org.id)
    expect((await answerGroup(g, bGroupJob.id, "done")).closed).toBe(true)
    const closed = await obligationById(b.org.id, bGroupJob.id)
    expect(closed?.progressDone).toBe(1)
    expect(closed?.state).toBe("closed")
    expect((await verifyDpdpEventChain(b.org.id)).ok).toBe(true)
  }, 60_000)

  test("no claims at all is refused by every signed-in function, not silently empty", async () => {
    let msg = ""
    try { await sql`select public.dpdp_answer_group('no-such-job', 'done')` } catch (e) { msg = message(e) }
    expect(msg).toContain("Job not found")
    msg = ""
    try { await sql`select public.dpdp_my_clients()` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await sql`select public.dpdp_create_client_org('X', 'firm', null)` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await sql`select public.dpdp_org_setup()` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await sql`select public.dpdp_owner_confirm_setup()` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
  }, 30_000)
})
