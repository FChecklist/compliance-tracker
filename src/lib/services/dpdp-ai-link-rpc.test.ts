/// <reference types="bun-types" />
// WO-DPDP-012 §7: the AI-link RPCs (drizzle/0607) exercised over the real
// database, on the same harness as dpdp-browser-rpc.test.ts -- every
// browser-side call runs inside ONE transaction with a transaction-local
// request.jwt.claims (what PostgREST does per request; a session-level
// set_config is silently lost by the transaction-mode pooler), and the two
// service-role-only functions the Edge Function calls (dpdp_ai_link_read /
// dpdp_draft_action) are called PLAIN, with no claims at all, exactly as
// the Edge Function's service-role client does -- app_runtime is granted
// them for this purpose (0607's grants block).
//
// UNRUN BY THE AUTHOR: no database was reachable from the session that
// wrote this. Written to pass first time against a project where 0607 has
// been applied; the PM's `bun test --isolate --env-file=.env.local
// src/lib/services/dpdp-ai-link-rpc.test.ts` is the first real run. Every
// org here is disposable @example.test data. Manual try/catch throughout,
// not expect().rejects -- see dpdp-group-answer.test.ts for the bun 1.3.14
// matcher hang this avoids.
import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

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
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation, dpdpEvent, dpdpAiLink, dpdpAiDraft } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

type Row = { id: string; what: string; by: string | null; isGroup: boolean; viewerIsGroupMember?: boolean | null; yes: boolean; na: boolean; due: string; dependsOnObligationId: string | null }
type Page = { org: { id: string }; viewer: { email: string; kind: string }; rows: Row[] }
type AiView = { org: { id: string; name: string }; viewer: { email: string; kind: string }; link: { id: string; expiresAt: string; readCount: number }; verbs: string[]; rows: Row[] }
type Created = { linkId: string; token: string; expiresAt: string; revokedPrevious: number }
type Drafted = { draftId: string; confirmToken: string; verb: string; obligationId: string | null; expiresAt: string }

const LINK_GONE = "This link has expired or was revoked"
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }

/** One request, as PostgREST would run it: a transaction whose claims die with it. */
async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
async function myPage(email: string): Promise<Page> {
  return asEmail(email, async (tx) => (await tx<{ page: Page }[]>`select public.dpdp_my_page() as page`)[0].page)
}
async function createLink(email: string, ttlHours?: number): Promise<Created> {
  return asEmail(email, async (tx) => (await tx<{ r: Created }[]>`select public.dpdp_create_ai_link(null, ${ttlHours ?? null}) as r`)[0].r)
}
async function revokeLink(email: string, linkId: string): Promise<{ ok: boolean }> {
  return asEmail(email, async (tx) => (await tx<{ r: { ok: boolean } }[]>`select public.dpdp_revoke_ai_link(${linkId}) as r`)[0].r)
}
/** The Edge Function's call: service-role style, no claims, the token is the credential. */
async function readLink(token: string): Promise<AiView> {
  return (await sql<{ r: AiView }[]>`select public.dpdp_ai_link_read(${token}) as r`)[0].r
}
async function draft(token: string, verb: string, obligationId: string | null, payload: Record<string, unknown>): Promise<Drafted> {
  return (await sql<{ r: Drafted }[]>`select public.dpdp_draft_action(${token}, ${verb}, ${obligationId}, ${JSON.stringify(payload)}::jsonb) as r`)[0].r
}
async function preview(email: string, draftId: string, confirmToken: string): Promise<{ verb: string; job: string | null; payload: Record<string, unknown>; expired: boolean; confirmedAt: string | null }> {
  return asEmail(email, async (tx) => (await tx<{ r: { verb: string; job: string | null; payload: Record<string, unknown>; expired: boolean; confirmedAt: string | null } }[]>`select public.dpdp_ai_draft_preview(${draftId}, ${confirmToken}) as r`)[0].r)
}
async function confirm(email: string, draftId: string, confirmToken: string): Promise<{ ok: boolean; verb: string }> {
  return asEmail(email, async (tx) => (await tx<{ r: { ok: boolean; verb: string } }[]>`select public.dpdp_confirm_ai_draft(${draftId}, ${confirmToken}) as r`)[0].r)
}
async function linkRow(linkId: string) {
  // The raw app_runtime connection with no tenant GUC: 0424's
  // app_runtime_preauth_lookup policy (current_org_id() IS NULL) admits the
  // SELECT; 0607 adds the table grant that was missing.
  return (await sql<{ token: string | null; token_hash: string | null; read_count: number; membership_id: string | null; revoked_at: Date | null }[]>`
    select token, token_hash, read_count, membership_id, revoked_at from dpdp.ai_link where id = ${linkId}`)[0]
}
async function confirmedEvents(orgId: string) {
  const rows = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, orgId) }))
  return rows.filter((e) => e.kind === "ai_draft_confirmed")
}
const staffVisible = (rows: Row[], email: string) => rows.filter((r) => r.by === email || (r.isGroup && !!r.viewerIsGroupMember))

async function seedIdentity(suffix: string) {
  const email = `wo012-ai-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

async function buildOrg(suffix: string) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO012 AI ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  const ownerMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
  return { owner, org, ownerMembershipId: ownerMembership!.id }
}

/** An org with one staff member named to "Customer data" through the real first-visit wizard. */
async function buildOrgWithStaff(suffix: string) {
  const built = await buildOrg(suffix)
  const staff = await seedIdentity(`staff-${suffix}`)
  await completeOwnerFirstVisit(built.org.id, built.owner.identityId, "Owner", built.ownerMembershipId, [
    { area: "Customer data", emails: [staff.email], na: false },
  ])
  return { ...built, staff }
}

d("WO-DPDP-012 §7: AI link RPCs", () => {
  test("create returns the token once; the row stores only its sha256; a second link retires the first", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, ownerMembershipId } = await buildOrg(suffix)

    const first = await createLink(owner.email)
    expect(first.token).toMatch(/^[0-9a-f]{64}$/)
    expect(first.revokedPrevious).toBe(0)
    const hours = (new Date(first.expiresAt).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(167)
    expect(hours).toBeLessThanOrEqual(168)

    const row = await linkRow(first.linkId)
    expect(row.token).toBeNull()
    expect(row.token_hash).toBe(sha256(first.token))
    expect(row.token_hash).not.toBe(first.token)
    expect(row.read_count).toBe(0)
    expect(row.membership_id).toBe(ownerMembershipId)

    // The 30-day cap holds whatever the caller asks for.
    const long = await createLink(owner.email, 100_000)
    expect(long.revokedPrevious).toBe(1)
    expect((new Date(long.expiresAt).getTime() - Date.now()) / 3_600_000).toBeLessThanOrEqual(720)
    expect((await linkRow(first.linkId)).revoked_at).not.toBeNull()
    let msg = ""
    try { await readLink(first.token) } catch (e) { msg = message(e) }
    expect(msg).toContain(LINK_GONE)
  }, 60_000)

  test("read: the owner gets exactly dpdp_my_page's rows; a staff member gets only their own -- no one else's email, never a sign-in token", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org } = await buildOrgWithStaff(suffix)

    const ownerLink = await createLink(owner.email)
    const ownerView = await readLink(ownerLink.token)
    const ownerPage = await myPage(owner.email)
    expect(ownerView.org.id).toBe(org.id)
    expect(ownerView.viewer).toEqual({ email: owner.email, kind: "owner" })
    expect(ownerView.verbs).toEqual(["ASSIGN", "SET_DUE", "NOTE", "MARK_NA", "DRAFT"])
    expect(ownerView.rows).toHaveLength(31)
    // The drift guard: dpdp__rows_for_membership is 0604's row builder verbatim.
    expect(ownerView.rows).toEqual(ownerPage.rows)
    expect(ownerView.rows.some((r) => r.by === staff.email)).toBe(true)

    const staffLink = await createLink(staff.email)
    const staffView = await readLink(staffLink.token)
    const staffPage = await myPage(staff.email)
    expect(staffView.viewer).toEqual({ email: staff.email, kind: "staff" })
    expect(staffView.rows.length).toBeGreaterThan(0)
    expect(staffView.rows.length).toBeLessThan(ownerView.rows.length)
    for (const r of staffView.rows) expect(r.by === staff.email || (r.isGroup && !!r.viewerIsGroupMember)).toBe(true)
    expect(staffView.rows.some((r) => r.by === owner.email)).toBe(false)
    expect(staffView.rows).toEqual(staffVisible(staffPage.rows, staff.email))
    // Owner-only rows (unassigned ones the owner must deal with) are absent.
    expect(ownerPage.rows.some((r) => !r.by && !r.isGroup)).toBe(true)
    expect(staffView.rows.some((r) => !r.by)).toBe(false)

    const serialised = JSON.stringify(staffView)
    expect(serialised).not.toMatch(/access_token|refresh_token|eyJ[A-Za-z0-9_-]{10,}/)
    expect(serialised).not.toContain(owner.email)
    expect(serialised).not.toContain("membershipId")

    expect((await linkRow(staffLink.linkId)).read_count).toBe(1)
    expect((await readLink(staffLink.token)).link.readCount).toBe(2)
    expect((await linkRow(staffLink.linkId)).read_count).toBe(2)
  }, 90_000)

  test("expired, revoked and unknown tokens are all refused with the same sentence", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)

    const expired = await createLink(owner.email)
    await withDpdpContext({ orgId: org.id }, (tx) => tx.update(dpdpAiLink).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(dpdpAiLink.id, expired.linkId)))
    let msg = ""
    try { await readLink(expired.token) } catch (e) { msg = message(e) }
    expect(msg).toContain(LINK_GONE)

    const revoked = await createLink(owner.email)
    expect((await readLink(revoked.token)).org.id).toBe(org.id)
    expect((await revokeLink(owner.email, revoked.linkId)).ok).toBe(true)
    msg = ""
    try { await readLink(revoked.token) } catch (e) { msg = message(e) }
    expect(msg).toContain(LINK_GONE)
    msg = ""
    try { await draft(revoked.token, "NOTE", null, { text: "x" }) } catch (e) { msg = message(e) }
    expect(msg).toContain(LINK_GONE)

    for (const bad of ["", "not-a-token", sha256(revoked.token), "a".repeat(64), "x".repeat(5000)]) {
      msg = ""
      try { await readLink(bad) } catch (e) { msg = message(e) }
      expect(msg).toContain(LINK_GONE)
    }
  }, 90_000)

  test("cross-tenant: a link for org A shows nothing of org B and cannot draft against org B's jobs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`a-${suffix}`)
    const b = await buildOrg(`b-${suffix}`)
    const linkA = await createLink(a.owner.email)
    const viewA = await readLink(linkA.token)
    const pageB = await myPage(b.owner.email)
    expect(viewA.org.id).toBe(a.org.id)
    const idsA = new Set(viewA.rows.map((r) => r.id))
    for (const r of pageB.rows) expect(idsA.has(r.id)).toBe(false)

    let msg = ""
    try { await draft(linkA.token, "NOTE", pageB.rows[0].id, { text: "hello" }) } catch (e) { msg = message(e) }
    expect(msg).toContain("not one this link can see")
    const draftsA = await withDpdpContext({ orgId: a.org.id }, (tx) => tx.query.dpdpAiDraft.findMany({ where: eq(dpdpAiDraft.orgId, a.org.id) }))
    const draftsB = await withDpdpContext({ orgId: b.org.id }, (tx) => tx.query.dpdpAiDraft.findMany({ where: eq(dpdpAiDraft.orgId, b.org.id) }))
    expect(draftsA).toHaveLength(0)
    expect(draftsB).toHaveLength(0)
  }, 90_000)

  test("draft_action refuses a sixth verb, an out-of-scope job and a reasonless MARK_NA -- and writes nothing", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org } = await buildOrgWithStaff(suffix)
    const staffLink = await createLink(staff.email)
    const staffView = await readLink(staffLink.token)
    const ownerPage = await myPage(owner.email)
    const mine = staffView.rows.find((r) => r.by === staff.email && !r.isGroup)!
    const notMine = ownerPage.rows.find((r) => r.by !== staff.email && !r.isGroup)!
    expect(mine).toBeDefined()
    expect(notMine).toBeDefined()

    let msg = ""
    try { await draft(staffLink.token, "close", mine.id, {}) } catch (e) { msg = message(e) }
    expect(msg).toContain("not something an AI link may draft")
    for (const verb of ["DELETE", "PUBLISH", "EXPORT", "ADD_PERSON", "REMOVE_PERSON", "SET_CAN_SIGN", "CLOSE"]) {
      msg = ""
      try { await draft(staffLink.token, verb, mine.id, {}) } catch (e) { msg = message(e) }
      expect(msg).toContain("not something an AI link may draft")
    }

    msg = ""
    try { await draft(staffLink.token, "NOTE", notMine.id, { text: "not my job" }) } catch (e) { msg = message(e) }
    expect(msg).toContain("not one this link can see")
    msg = ""
    try { await draft(staffLink.token, "NOTE", "no-such-obligation", { text: "x" }) } catch (e) { msg = message(e) }
    expect(msg).toContain("not one this link can see")
    msg = ""
    try { await draft(staffLink.token, "MARK_NA", mine.id, {}) } catch (e) { msg = message(e) }
    expect(msg).toContain("written reason")
    msg = ""
    try { await draft(staffLink.token, "SET_DUE", mine.id, { dueOn: "2026-13-45" }) } catch (e) { msg = message(e) }
    expect(msg).toContain("YYYY-MM-DD")
    msg = ""
    try { await draft(staffLink.token, "ASSIGN", mine.id, { email: "no-at-sign" }) } catch (e) { msg = message(e) }
    expect(msg).toContain("payload.email")

    const drafts = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpAiDraft.findMany({ where: eq(dpdpAiDraft.orgId, org.id) }))
    expect(drafts).toHaveLength(0)
    expect((await confirmedEvents(org.id))).toHaveLength(0)
    const untouched = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, mine.id) }))
    expect(untouched?.state).toBe("open")

    // A well-formed draft is one ai_draft row and NOTHING else -- no event,
    // no obligation change.
    const ok = await draft(staffLink.token, "NOTE", mine.id, { text: "drafted, not applied" })
    expect(ok.confirmToken).toMatch(/^[0-9a-f]{64}$/)
    const after = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpAiDraft.findMany({ where: eq(dpdpAiDraft.orgId, org.id) }))
    expect(after).toHaveLength(1)
    expect(after[0].confirmTokenHash).toBe(sha256(ok.confirmToken))
    expect(after[0].confirmedAt).toBeNull()
    expect((await confirmedEvents(org.id))).toHaveLength(0)
  }, 90_000)

  test("confirm refuses another signed-in member and a wrong token; the right person applies a NOTE and history says who drafted and who confirmed", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org } = await buildOrgWithStaff(suffix)
    const staffLink = await createLink(staff.email)
    const mine = (await readLink(staffLink.token)).rows.find((r) => r.by === staff.email && !r.isGroup)!
    const dr = await draft(staffLink.token, "NOTE", mine.id, { text: "Talked to the vendor on Monday" })

    let msg = ""
    try { await confirm(owner.email, dr.draftId, dr.confirmToken) } catch (e) { msg = message(e) }
    expect(msg).toContain("someone else's AI link")
    msg = ""
    try { await confirm(staff.email, dr.draftId, "0".repeat(64)) } catch (e) { msg = message(e) }
    expect(msg).toContain("not valid")
    msg = ""
    try { await sql`select public.dpdp_confirm_ai_draft(${dr.draftId}, ${dr.confirmToken})` } catch (e) { msg = message(e) }
    expect(msg).toContain("someone else's AI link")
    expect((await confirmedEvents(org.id))).toHaveLength(0)

    const shown = await preview(staff.email, dr.draftId, dr.confirmToken)
    expect(shown.verb).toBe("NOTE")
    expect(shown.job).toBe(mine.what)
    expect(shown.payload).toEqual({ text: "Talked to the vendor on Monday" })
    expect(shown.expired).toBe(false)
    expect(shown.confirmedAt).toBeNull()

    expect((await confirm(staff.email, dr.draftId, dr.confirmToken)).ok).toBe(true)
    msg = ""
    try { await confirm(staff.email, dr.draftId, dr.confirmToken) } catch (e) { msg = message(e) }
    expect(msg).toContain("already been confirmed")

    const events = await confirmedEvents(org.id)
    expect(events).toHaveLength(1)
    expect(events[0].summary.startsWith(`drafted by AI, confirmed by ${staff.email}`)).toBe(true)
    expect(events[0].detail).toBe("Talked to the vendor on Monday")
    expect(events[0].actorIdentityId).toBe(staff.identityId)
    const chain = await verifyDpdpEventChain(org.id)
    expect(chain.ok).toBe(true)
    const stillOpen = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, mine.id) }))
    expect(stillOpen?.state).toBe("open")

    // A staff member cannot confirm an ASSIGN even from their own link.
    const give = await draft(staffLink.token, "ASSIGN", mine.id, { email: `wo012-ai-other-${suffix}@example.test` })
    msg = ""
    try { await confirm(staff.email, give.draftId, give.confirmToken) } catch (e) { msg = message(e) }
    expect(msg).toContain("Only the owner")
    expect((await confirmedEvents(org.id))).toHaveLength(1)
  }, 90_000)

  test("a confirmed ASSIGN creates the identity + membership, assigns the job, and writes exactly one 'drafted by AI, confirmed by' event -- chain intact", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const link = await createLink(owner.email)
    const view = await readLink(link.token)
    const target = view.rows.find((r) => !r.by && !r.isGroup && !r.yes && !r.na)!
    expect(target).toBeDefined()
    const newEmail = `wo012-ai-named-${suffix}@example.test`

    const dr = await draft(link.token, "ASSIGN", target.id, { email: newEmail.toUpperCase() })
    expect((await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, newEmail) }))).toBeUndefined()

    const result = await confirm(owner.email, dr.draftId, dr.confirmToken)
    expect(result).toEqual({ ok: true, verb: "ASSIGN", obligationId: target.id })

    const identityEmail = await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, newEmail) })
    expect(identityEmail).toBeDefined()
    const membership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, identityEmail!.identityId), eq(m.orgId, org.id)) })
    expect(membership?.level).toBe("staff")
    expect(membership?.state).toBe("active")
    expect(membership?.joinedVia).toBe("named_in_role")
    const assigned = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, target.id) }))
    expect(assigned?.assignedPersonId).toBe(identityEmail!.identityId)

    const events = await confirmedEvents(org.id)
    expect(events).toHaveLength(1)
    expect(events[0].summary.startsWith(`drafted by AI, confirmed by ${owner.email}`)).toBe(true)
    expect(events[0].summary).toContain(newEmail)
    expect(events[0].actorIdentityId).toBe(owner.identityId)
    const chain = await verifyDpdpEventChain(org.id)
    expect(chain.ok).toBe(true)
    expect(chain.checked).toBeGreaterThanOrEqual(3)

    // Persisted, not just reported: the owner's page now shows the new
    // person on that job, and the new person can sign in and see it too.
    expect((await myPage(owner.email)).rows.find((r) => r.id === target.id)?.by).toBe(newEmail)
    const theirPage = await myPage(newEmail)
    expect(theirPage.viewer.kind).toBe("staff")
    expect(theirPage.rows.find((r) => r.id === target.id)?.by).toBe(newEmail)

    const draftRow = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpAiDraft.findFirst({ where: eq(dpdpAiDraft.id, dr.draftId) }))
    expect(draftRow?.confirmedAt).not.toBeNull()
    expect(draftRow?.confirmedBy).toBe(owner.identityId)
  }, 90_000)

  test("owner-only verbs: SET_DUE and MARK_NA apply for the owner and persist", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const link = await createLink(owner.email)
    const rows = (await readLink(link.token)).rows.filter((r) => !r.isGroup && !r.yes && !r.na)
    const [dueRow, naRow] = rows

    const due = await draft(link.token, "SET_DUE", dueRow.id, { dueOn: "2027-03-15" })
    expect((await confirm(owner.email, due.draftId, due.confirmToken)).ok).toBe(true)
    const na = await draft(link.token, "MARK_NA", naRow.id, { reason: "We have no bus service" })
    expect((await confirm(owner.email, na.draftId, na.confirmToken)).ok).toBe(true)

    const after = await myPage(owner.email)
    expect(after.rows.find((r) => r.id === dueRow.id)?.due).toBe("2027-03-15")
    expect(after.rows.find((r) => r.id === naRow.id)?.na).toBe(true)
    const naObligation = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, naRow.id) }))
    expect(naObligation?.naReason).toBe("We have no bus service")

    const events = await confirmedEvents(org.id)
    expect(events).toHaveLength(2)
    for (const e of events) expect(e.summary.startsWith(`drafted by AI, confirmed by ${owner.email}`)).toBe(true)
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 90_000)

  test("no claims at all is refused for every browser-side function", async () => {
    let msg = ""
    try { await sql`select public.dpdp_create_ai_link()` } catch (e) { msg = message(e) }
    expect(msg).toContain("Not a member of this organisation")
    msg = ""
    try { await sql`select public.dpdp_ai_draft_preview('nope', 'nope')` } catch (e) { msg = message(e) }
    expect(msg).toContain("not valid")
  }, 30_000)
})
