/// <reference types="bun-types" />
// WO-DPDP-013 Part 1 (drizzle/0610): the AI WORK link's RPCs exercised over
// the real database, on the same harness as dpdp-ai-link-rpc.test.ts --
// every browser-side call runs inside ONE transaction with a
// transaction-local request.jwt.claims (what PostgREST does per request),
// and the service-role-only functions the Edge Function calls
// (dpdp_ai_link_context / _jobs / _job / _law / _report / _history /
// _action / _draft / _log_call / _log_call_result / the timer hook) are
// called PLAIN, with no claims at all, exactly as the Edge Function's
// service-role client does -- app_runtime is granted them for this purpose
// (0610's grants block).
//
// What this file proves (WO-013 §1.4, R74-RULING-03 -- every assertion
// re-reads persisted state, never a success message):
//   * cross-tenant: a token for org A never returns an org B row on ANY
//     endpoint, and cannot act or draft against org B's jobs;
//   * a Level 0 link fails EVERY write -- the four Level 1 verbs and every
//     Level 2 verb -- and writes nothing;
//   * a Level 1 link applies the four verbs (persisted, "by <person> via AI
//     assistant" in history, flagged for the Monday digest) and still fails
//     every Level 2 verb; ASSIGN to a non-member is refused and creates
//     nobody; the person's own authority still applies (a staff member's
//     Level 1 link cannot SET_DUE);
//   * expiry and revocation are refused on the next call;
//   * hide_emails hides everyone else's email, never the person's own;
//   * undo within 24 h restores the previous state; outside refuses;
//   * every call is logged, the rate-limit count grows, and "Your AI links"
//     shows callCount / lastUsedAt.
//
// UNRUN BY THE AUTHOR: no database was reachable from the worktree that
// wrote this (no .env.local). Written to pass first time against a project
// where 0610 has been applied; the PM's `bun test --isolate
// --env-file=.env.local src/lib/services/dpdp-ai-work-link-rpc.test.ts` is
// the first real run. Every org here is disposable @example.test data.
// Manual try/catch throughout, not expect().rejects -- see
// dpdp-group-answer.test.ts for the bun 1.3.14 matcher hang this avoids.
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
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation, dpdpEvent, dpdpAiLink, dpdpAiDraft, dpdpAiAction, dpdpAiLinkCall } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

const LINK_GONE = "This link has expired or was revoked"
const LEVEL1 = ["NOTE", "SET_DUE", "ASSIGN", "MARK_NA"] as const
const LEVEL2 = ["MARK_DONE", "OWNER_CONFIRM", "MANAGER_CHECK", "PARTNER_SIGN", "DELETE", "ADD_PERSON", "REMOVE_PERSON", "CHANGE_SIGNER", "PUBLISH", "EXPORT_PERSONAL_DATA"] as const
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

type Job = { id: string; part: number; what: string; by: string | null; byIsYou: boolean; isGroup: boolean; due: string; yes: boolean; na: boolean; status: string; late: boolean; requiredToday: boolean; lawCodes: string[] | null }
type Ctx = { org: { id: string; name: string }; viewer: { email: string; kind: string; level: string }; link: { id: string; label: string | null; authorityLevel: number; hideEmails: boolean; expiresAt: string; callCount: number }; library: { version: string | null }; counts: { jobs: number; people: number }; verbs: { level1: string[]; level2: string[] } }
type Created = { linkId: string; token: string; level: number; hideEmails: boolean; label: string | null; expiresAt: string; jobs: number; people: number }
type Listed = { id: string; label: string | null; level: number; hideEmails: boolean; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; callCount: number; active: boolean }
type Acted = { actionId: string; verb: string; jobId: string; appliedAt: string; undoableUntil: string; undoToken: string; recorded: string }
type Drafted = { draftId: string; confirmToken: string; verb: string; jobId: string | null; expiresAt: string; executableOnConfirm: boolean }
type HistoryEntry = { id: string; kind: string; summary: string; detail: string | null; actorLabel: string; occurredAt: string }

/** One request, as PostgREST would run it: a transaction whose claims die with it. */
async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
async function myPage(email: string) {
  return asEmail(email, async (tx) => (await tx<{ page: { org: { id: string }; rows: Array<{ id: string; what: string; by: string | null; due: string; na: boolean; yes: boolean; isGroup: boolean }> } }[]>`select public.dpdp_my_page() as page`)[0].page)
}
async function create(email: string, opts: { level?: number; hideEmails?: boolean; days?: number; label?: string | null } = {}): Promise<Created> {
  return asEmail(email, async (tx) => (await tx<{ r: Created }[]>`select public.dpdp_ai_link_create(${opts.level ?? 0}, ${opts.hideEmails ?? false}, ${opts.days ?? 7}, ${opts.label ?? null}) as r`)[0].r)
}
async function warning(email: string) {
  return asEmail(email, async (tx) => (await tx<{ r: { jobs: number; people: number } }[]>`select public.dpdp_ai_link_warning() as r`)[0].r)
}
async function list(email: string): Promise<Listed[]> {
  return asEmail(email, async (tx) => (await tx<{ r: Listed[] }[]>`select public.dpdp_ai_link_list() as r`)[0].r)
}
async function revoke(email: string, id: string) {
  return asEmail(email, async (tx) => (await tx<{ r: { ok: boolean } }[]>`select public.dpdp_ai_link_revoke(${id}) as r`)[0].r)
}
async function undo(email: string, actionId: string, token: string) {
  return asEmail(email, async (tx) => (await tx<{ r: { ok: boolean; verb: string; jobId: string } }[]>`select public.dpdp_ai_action_undo(${actionId}, ${token}) as r`)[0].r)
}
async function confirm(email: string, draftId: string, confirmToken: string) {
  return asEmail(email, async (tx) => (await tx<{ r: { ok: boolean; verb: string } }[]>`select public.dpdp_confirm_ai_draft(${draftId}, ${confirmToken}) as r`)[0].r)
}
// The Edge Function's calls: service-role style, no claims, the token is the credential.
async function context(token: string): Promise<Ctx> {
  return (await sql<{ r: Ctx }[]>`select public.dpdp_ai_link_context(${token}) as r`)[0].r
}
async function jobs(token: string, filters: Record<string, unknown> = {}): Promise<Job[]> {
  // sql.json(), not a stringified cast: postgres.js JSON-encodes a string
  // param bound as jsonb a second time, which reaches the RPC as a jsonb string.
  return (await sql<{ r: Job[] }[]>`select public.dpdp_ai_link_jobs(${token}, ${sql.json(filters)}) as r`)[0].r
}
async function job(token: string, id: string) {
  return (await sql<{ r: Job & { plainText: string; emailsSent: number; history: HistoryEntry[]; aiActions: unknown[] } }[]>`select public.dpdp_ai_link_job(${token}, ${id}) as r`)[0].r
}
async function law(token: string, code: string) {
  return (await sql<{ r: { code: string; inForceToday: boolean; legalDuty: boolean; jobs: Array<{ id: string }> } }[]>`select public.dpdp_ai_link_law(${token}, ${code}) as r`)[0].r
}
async function report(token: string, kind: string) {
  return (await sql<{ r: Record<string, unknown> & { org: { id: string } } }[]>`select public.dpdp_ai_link_report(${token}, ${kind}) as r`)[0].r
}
async function history(token: string): Promise<HistoryEntry[]> {
  return (await sql<{ r: HistoryEntry[] }[]>`select public.dpdp_ai_link_history(${token}) as r`)[0].r
}
async function action(token: string, verb: string, jobId: string | null, value: Record<string, unknown> = {}): Promise<Acted> {
  return (await sql<{ r: Acted }[]>`select public.dpdp_ai_link_action(${token}, ${verb}, ${jobId}, ${sql.json(value)}) as r`)[0].r
}
async function draft(token: string, verb: string, jobId: string | null, value: Record<string, unknown> = {}): Promise<Drafted> {
  return (await sql<{ r: Drafted }[]>`select public.dpdp_ai_link_draft(${token}, ${verb}, ${jobId}, ${sql.json(value)}) as r`)[0].r
}
async function logCall(token: string, method: string, path: string) {
  return (await sql<{ r: { callId: string; linkId: string | null; callsLastMinute: number; limitPerMinute: number } }[]>`select public.dpdp_ai_link_log_call(${token}, ${method}, ${path}) as r`)[0].r
}
async function logResult(callId: string, status: number, bytes: number | null) {
  return (await sql<{ r: { ok: boolean } }[]>`select public.dpdp_ai_link_log_call_result(${callId}, ${status}, ${bytes}) as r`)[0].r
}
async function forDigest(membershipId: string, mark = false) {
  return (await sql<{ r: Array<{ actionId: string; verb: string; stillUndoable: boolean }> }[]>`select public.dpdp_timer_ai_actions_for_digest(${membershipId}, ${mark}) as r`)[0].r
}
async function refuse(run: () => Promise<unknown>): Promise<string> {
  try { await run() } catch (e) { return message(e) }
  return ""
}

async function obligation(orgId: string, id: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, id) }))
}
async function events(orgId: string, kind: string) {
  const rows = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, orgId) }))
  return rows.filter((e) => e.kind === kind)
}
async function actions(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpAiAction.findMany({ where: eq(dpdpAiAction.orgId, orgId) }))
}
async function calls(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpAiLinkCall.findMany({ where: eq(dpdpAiLinkCall.orgId, orgId) }))
}
async function drafts(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpAiDraft.findMany({ where: eq(dpdpAiDraft.orgId, orgId) }))
}

async function seedIdentity(suffix: string) {
  const email = `wo013-ai-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}
async function buildOrg(suffix: string) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO013 AI ${suffix}`, product: "firm" })
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
  const staffMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, staff.identityId), eq(m.orgId, built.org.id)) })
  return { ...built, staff, staffMembershipId: staffMembership!.id }
}

d("WO-DPDP-013 Part 1: the AI work link", () => {
  test("create: level / days validated; token once, only its sha256 stored; data-warning counts; 'Your AI links' lists, revoke takes effect on the next call", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org, ownerMembershipId } = await buildOrgWithStaff(suffix)

    expect(await refuse(() => create(owner.email, { level: 2 }))).toContain("level must be 0")
    expect(await refuse(() => create(owner.email, { days: 3 }))).toContain("1, 7 or 30 days")
    expect(await refuse(() => sql`select public.dpdp_ai_link_create()`)).toContain("Not a member of this organisation")

    const warn = await warning(owner.email)
    expect(warn.jobs).toBe(31)
    expect(warn.people).toBe(2) // the owner and the one staff member

    const a = await create(owner.email, { label: "  ChatGPT, Sept  " })
    expect(a.token).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toMatchObject({ level: 0, hideEmails: false, label: "ChatGPT, Sept", jobs: 31, people: 2 })
    const days = (new Date(a.expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThanOrEqual(7)
    const row = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpAiLink.findFirst({ where: eq(dpdpAiLink.id, a.linkId) }))
    expect(row?.token).toBeNull()
    expect(row?.tokenHash).toBe(sha256(a.token))
    expect(row?.authorityLevel).toBe(0)
    expect(row?.membershipId).toBe(ownerMembershipId)
    expect(row?.createdByMembershipId).toBe(ownerMembershipId)

    // Several live links per person; each listed, newest first.
    const b = await create(owner.email, { level: 1, hideEmails: true, days: 30 })
    expect((await context(a.token)).org.id).toBe(org.id)
    expect((await context(b.token)).link.authorityLevel).toBe(1)
    const listed = await list(owner.email)
    expect(listed.map((l) => l.id)).toEqual([b.linkId, a.linkId])
    expect(listed[0]).toMatchObject({ level: 1, hideEmails: true, active: true, revokedAt: null })
    expect(listed[1]).toMatchObject({ level: 0, label: "ChatGPT, Sept", active: true })
    // Another member's list never shows the owner's links.
    expect((await list(staff.email)).map((l) => l.id)).not.toContain(a.linkId)

    // The event says which level.
    const made = await events(org.id, "ai_link_created")
    expect(made.length).toBeGreaterThanOrEqual(2)
    expect(made.some((e) => e.detail?.startsWith("Level 1 (small edits, directly), other people's emails hidden"))).toBe(true)

    // Revoke: refused for a stranger's session, effective on the next call for the owner.
    expect((await revoke(owner.email, a.linkId)).ok).toBe(true)
    expect(await refuse(() => context(a.token))).toContain(LINK_GONE)
    expect(await refuse(() => jobs(a.token))).toContain(LINK_GONE)
    expect((await list(owner.email)).find((l) => l.id === a.linkId)).toMatchObject({ active: false })
    expect((await list(owner.email)).find((l) => l.id === a.linkId)?.revokedAt).not.toBeNull()
    expect((await context(b.token)).org.id).toBe(org.id)
  }, 240_000)

  test("cross-tenant: a token for org A never returns an org B row on any endpoint, and cannot act or draft on org B's jobs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const A = await buildOrgWithStaff(`a-${suffix}`)
    const B = await buildOrgWithStaff(`b-${suffix}`)
    const linkA = await create(A.owner.email, { level: 1 })
    const pageB = await myPage(B.owner.email)
    const idsB = new Set(pageB.rows.map((r) => r.id))

    const ctx = await context(linkA.token)
    expect(ctx.org.id).toBe(A.org.id)
    expect(ctx.viewer.email).toBe(A.owner.email)
    const rowsA = await jobs(linkA.token)
    expect(rowsA).toHaveLength(31)
    for (const r of rowsA) expect(idsB.has(r.id)).toBe(false)
    expect(JSON.stringify(rowsA)).not.toContain(B.staff.email)

    expect(await refuse(() => job(linkA.token, pageB.rows[0].id))).toContain("not one this link can see")
    for (const code of ["d:§8(9)", "s:R5(9)", "g:"]) {
      const l = await law(linkA.token, code)
      for (const j of l.jobs) expect(idsB.has(j.id)).toBe(false)
    }
    for (const kind of ["summary", "by-person", "by-law", "by-part"]) {
      const r = await report(linkA.token, kind)
      expect(r.org.id).toBe(A.org.id)
      expect(JSON.stringify(r)).not.toContain(B.staff.email)
      expect(JSON.stringify(r)).not.toContain(B.org.name)
      for (const id of idsB) expect(JSON.stringify(r)).not.toContain(id)
    }
    const histB = await asEmail(B.owner.email, async (tx) => (await tx<{ r: HistoryEntry[] }[]>`select public.dpdp_org_history(null, 50) as r`)[0].r)
    const histA = await history(linkA.token)
    expect(histA.length).toBeGreaterThan(0)
    const idsHistB = new Set(histB.map((h) => h.id))
    for (const h of histA) expect(idsHistB.has(h.id)).toBe(false)
    expect(JSON.stringify(histA)).not.toContain(B.owner.email)

    expect(await refuse(() => action(linkA.token, "NOTE", pageB.rows[0].id, { text: "x" }))).toContain("not one this link can see")
    expect(await refuse(() => draft(linkA.token, "MARK_DONE", pageB.rows[0].id))).toContain("not one this link can see")
    expect(await actions(A.org.id)).toHaveLength(0)
    expect(await actions(B.org.id)).toHaveLength(0)
    expect(await drafts(B.org.id)).toHaveLength(0)
    expect((await obligation(B.org.id, pageB.rows[0].id))?.state).toBe("open")
  }, 240_000)

  test("Level 0 fails EVERY write -- the four Level 1 verbs and every Level 2 verb -- and writes nothing; drafts still work", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const link = await create(owner.email, { level: 0 })
    const rows = await jobs(link.token)
    const target = rows.find((r) => !r.isGroup && !r.yes && !r.na)!
    expect(target).toBeDefined()
    const before = await obligation(org.id, target.id)

    for (const verb of LEVEL1) {
      const msg = await refuse(() => action(link.token, verb, target.id, { text: "x", dueOn: "2027-01-01", email: owner.email, reason: "r" }))
      expect(msg, verb).toContain("read-only (Level 0)")
    }
    for (const verb of LEVEL2) {
      const msg = await refuse(() => action(link.token, verb, target.id, {}))
      expect(msg, verb).toContain("has legal weight")
      expect(msg, verb).toContain("POST /drafts")
    }
    expect(await refuse(() => action(link.token, "close", target.id))).toContain("is not an action")
    expect(await actions(org.id)).toHaveLength(0)
    expect(await events(org.id, "ai_action_applied")).toHaveLength(0)
    const after = await obligation(org.id, target.id)
    expect(after).toEqual(before)
    expect((await context(link.token)).verbs.level1).toEqual([])

    // Level 2 as a DRAFT is fine at Level 0: one ai_draft row and nothing else,
    // then the owner confirms MARK_DONE in their own session and it persists.
    const dr = await draft(link.token, "MARK_DONE", target.id)
    expect(dr.confirmToken).toMatch(/^[0-9a-f]{64}$/)
    expect(dr.executableOnConfirm).toBe(true)
    expect((await obligation(org.id, target.id))?.state).toBe("open")
    expect((await drafts(org.id))).toHaveLength(1)
    expect((await confirm(owner.email, dr.draftId, dr.confirmToken)).ok).toBe(true)
    expect((await obligation(org.id, target.id))?.state).toBe("closed")
    const confirmed = await events(org.id, "ai_draft_confirmed")
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0].summary).toBe(`drafted by AI, confirmed by ${owner.email} -- marked "${target.what}" done`)

    // A verb the confirm screen cannot execute yet: drafted, refused on confirm, nothing changes.
    const sign = await draft(link.token, "PARTNER_SIGN", null)
    expect(sign.executableOnConfirm).toBe(false)
    expect(await refuse(() => confirm(owner.email, sign.draftId, sign.confirmToken))).toContain("cannot be confirmed here yet")
    const signRow = (await drafts(org.id)).find((x) => x.id === sign.draftId)
    expect(signRow?.confirmedAt).toBeNull()
    expect(await refuse(() => draft(link.token, "EXPLODE", null))).toContain("not something an AI link may draft")
    expect(await refuse(() => draft(link.token, "DELETE", target.id, {}))).toContain("needs value.reason")
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 240_000)

  test("Level 1 applies NOTE / SET_DUE / ASSIGN / MARK_NA under the person's authority, persisted and in history 'by <person> via AI assistant'; every Level 2 verb still refused; ASSIGN only to existing members", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org, ownerMembershipId, staffMembershipId } = await buildOrgWithStaff(suffix)
    const link = await create(owner.email, { level: 1 })
    expect((await context(link.token)).verbs.level1).toEqual([...LEVEL1])
    const rows = await jobs(link.token)
    const open = rows.filter((r) => !r.isGroup && !r.yes && !r.na)
    const [noteRow, dueRow, assignRow, naRow] = open
    expect(naRow).toBeDefined()

    const note = await action(link.token, "NOTE", noteRow.id, { text: "Vendor agreement signed on 20 Sep" })
    expect(note.undoToken).toMatch(/^[0-9a-f]{64}$/)
    expect(note.recorded).toBe(`by ${owner.email} via AI assistant -- added a note to "${noteRow.what}"`)
    const due = await action(link.token, "SET_DUE", dueRow.id, { dueOn: "2027-03-15" })
    const give = await action(link.token, "ASSIGN", assignRow.id, { email: staff.email.toUpperCase() })
    const na = await action(link.token, "MARK_NA", naRow.id, { reason: "We have no bus service" })
    for (const a of [note, due, give, na]) {
      expect((new Date(a.undoableUntil).getTime() - new Date(a.appliedAt).getTime()) / 3_600_000).toBe(24)
    }

    // Persisted, on the owner's own page and in the table.
    const page = await myPage(owner.email)
    expect(page.rows.find((r) => r.id === dueRow.id)?.due).toBe("2027-03-15")
    expect(page.rows.find((r) => r.id === assignRow.id)?.by).toBe(staff.email)
    expect(page.rows.find((r) => r.id === naRow.id)?.na).toBe(true)
    expect((await obligation(org.id, naRow.id))?.naReason).toBe("We have no bus service")
    const applied = await events(org.id, "ai_action_applied")
    expect(applied).toHaveLength(4)
    for (const e of applied) {
      expect(e.summary.startsWith(`by ${owner.email} via AI assistant -- `)).toBe(true)
      expect(e.actorIdentityId).toBe(owner.identityId)
    }
    expect(applied.find((e) => e.summary.includes("added a note"))?.detail).toBe("Vendor agreement signed on 20 Sep")
    const stored = await actions(org.id)
    expect(stored).toHaveLength(4)
    for (const a of stored) {
      expect(a.membershipId).toBe(ownerMembershipId)
      expect(a.linkId).toBe(link.linkId)
      expect(a.digestPending).toBe(true)
      expect(a.undoneAt).toBeNull()
    }
    expect(stored.find((a) => a.id === due.actionId)?.previous).toEqual({ dueOn: dueRow.due })
    expect(stored.find((a) => a.id === note.actionId)?.undoTokenHash).toBe(sha256(note.undoToken))
    expect((await job(link.token, noteRow.id)).aiActions).toHaveLength(1)
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)

    // The Monday digest sees them; marking clears the flag.
    expect((await forDigest(ownerMembershipId)).map((a) => a.actionId).sort()).toEqual([note, due, give, na].map((a) => a.actionId).sort())
    expect((await forDigest(ownerMembershipId, true))).toHaveLength(4)
    expect((await forDigest(ownerMembershipId))).toHaveLength(0)
    expect((await actions(org.id)).every((a) => !a.digestPending && a.digestedAt !== null)).toBe(true)

    // Every Level 2 verb is refused at Level 1 too, and nothing more is written.
    for (const verb of LEVEL2) {
      expect(await refuse(() => action(link.token, verb, open[4].id, {})), verb).toContain("has legal weight")
    }
    // ASSIGN to a non-member: refused, and no identity or membership is created.
    const stranger = `wo013-ai-stranger-${suffix}@example.test`
    expect(await refuse(() => action(link.token, "ASSIGN", open[4].id, { email: stranger }))).toContain("is not a member of this organisation")
    expect(await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, stranger) })).toBeUndefined()
    expect(await refuse(() => action(link.token, "MARK_NA", open[5].id, {}))).toContain("written reason")
    expect(await refuse(() => action(link.token, "SET_DUE", open[5].id, { dueOn: "2026-13-45" }))).toContain("YYYY-MM-DD")
    expect(await actions(org.id)).toHaveLength(4)

    // The person's own authority still applies: a staff member's Level 1
    // link can NOTE and MARK_NA their own job, not SET_DUE or ASSIGN, and
    // cannot touch a job that is not theirs.
    const staffLink = await create(staff.email, { level: 1 })
    const mine = (await jobs(staffLink.token, { mine: true })).find((r) => !r.isGroup && !r.na && !r.yes)!
    expect(mine).toBeDefined()
    expect(mine.byIsYou).toBe(true)
    expect(await refuse(() => action(staffLink.token, "SET_DUE", mine.id, { dueOn: "2027-01-01" }))).toContain("Only the owner")
    expect(await refuse(() => action(staffLink.token, "ASSIGN", mine.id, { email: owner.email }))).toContain("Only the owner")
    expect(await refuse(() => action(staffLink.token, "NOTE", dueRow.id, { text: "not mine" }))).toContain("not one this link can see")
    const staffNote = await action(staffLink.token, "NOTE", mine.id, { text: "Started on this" })
    expect(staffNote.recorded).toBe(`by ${staff.email} via AI assistant -- added a note to "${mine.what}"`)
    expect((await actions(org.id)).find((a) => a.id === staffNote.actionId)?.membershipId).toBe(staffMembershipId)
  }, 240_000)

  test("undo within 24 hours restores the previous state (by the person or the owner, with the token); outside, twice, a wrong token or a stranger refuses", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org } = await buildOrgWithStaff(suffix)
    const link = await create(owner.email, { level: 1 })
    const rows = await jobs(link.token)
    const open = rows.filter((r) => !r.isGroup && !r.yes && !r.na && !r.byIsYou)
    const [dueRow, assignRow, naRow, noteRow] = open
    const staffRow = rows.find((r) => r.by === staff.email && !r.isGroup)!

    const due = await action(link.token, "SET_DUE", dueRow.id, { dueOn: "2027-03-15" })
    const give = await action(link.token, "ASSIGN", staffRow.id, { email: owner.email })
    const na = await action(link.token, "MARK_NA", naRow.id, { reason: "not us" })
    const note = await action(link.token, "NOTE", noteRow.id, { text: "hello" })
    expect((await obligation(org.id, staffRow.id))?.assignedPersonId).toBe(owner.identityId)

    expect(await refuse(() => undo(owner.email, due.actionId, "0".repeat(64)))).toContain("not valid")
    expect(await refuse(() => undo(staff.email, due.actionId, due.undoToken))).toContain("Only the person")
    expect(await refuse(() => sql`select public.dpdp_ai_action_undo(${due.actionId}, ${due.undoToken})`)).toContain("Only the person")
    expect((await obligation(org.id, dueRow.id))?.dueOn).toBe("2027-03-15")

    expect(await undo(owner.email, due.actionId, due.undoToken)).toEqual({ ok: true, verb: "SET_DUE", jobId: dueRow.id })
    expect((await myPage(owner.email)).rows.find((r) => r.id === dueRow.id)?.due).toBe(dueRow.due)
    expect(await refuse(() => undo(owner.email, due.actionId, due.undoToken))).toContain("already undone")

    expect((await undo(owner.email, give.actionId, give.undoToken)).ok).toBe(true)
    expect((await obligation(org.id, staffRow.id))?.assignedPersonId).toBe(staff.identityId)
    expect((await undo(owner.email, na.actionId, na.undoToken)).ok).toBe(true)
    const restored = await obligation(org.id, naRow.id)
    expect(restored?.state).toBe("open")
    expect(restored?.naReason).toBeNull()
    expect((await undo(owner.email, note.actionId, note.undoToken)).ok).toBe(true)
    const undone = await events(org.id, "ai_action_undone")
    expect(undone).toHaveLength(4)
    expect(undone.some((e) => e.summary.includes("withdrew the note"))).toBe(true)
    expect((await actions(org.id)).every((a) => a.undoneAt !== null)).toBe(true)
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)

    // Past the 24 hours: refused, state untouched.
    const late = await action(link.token, "SET_DUE", dueRow.id, { dueOn: "2027-06-01" })
    await withDpdpContext({ orgId: org.id }, (tx) => tx.update(dpdpAiAction).set({ undoableUntil: new Date(Date.now() - 60_000) }).where(eq(dpdpAiAction.id, late.actionId)))
    expect(await refuse(() => undo(owner.email, late.actionId, late.undoToken))).toContain("24 hours have passed")
    expect((await obligation(org.id, dueRow.id))?.dueOn).toBe("2027-06-01")
    // The Monday email's re-minted token is refused for it too.
    const reissue = (await sql<{ r: { ok: boolean; reason?: string } }[]>`select public.dpdp_timer_issue_undo_token(${late.actionId}) as r`)[0].r
    expect(reissue).toEqual({ ok: false, reason: "not undoable" })
    // ...and works for a fresh one: the old token dies, the new one undoes.
    const fresh = await action(link.token, "NOTE", noteRow.id, { text: "again" })
    const minted = (await sql<{ r: { ok: boolean; undoToken: string } }[]>`select public.dpdp_timer_issue_undo_token(${fresh.actionId}) as r`)[0].r
    expect(minted.ok).toBe(true)
    expect(await refuse(() => undo(owner.email, fresh.actionId, fresh.undoToken))).toContain("not valid")
    expect((await undo(owner.email, fresh.actionId, minted.undoToken)).ok).toBe(true)
  }, 240_000)

  test("expiry and revocation are refused on the very next call, on every endpoint; unknown tokens the same", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const link = await create(owner.email, { level: 1 })
    const target = (await jobs(link.token)).find((r) => !r.isGroup)!

    await withDpdpContext({ orgId: org.id }, (tx) => tx.update(dpdpAiLink).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(dpdpAiLink.id, link.linkId)))
    const everything = (token: string): Array<[string, () => Promise<unknown>]> => [
      ["context", () => context(token)], ["jobs", () => jobs(token)], ["job", () => job(token, target.id)], ["law", () => law(token, "g:")],
      ["report", () => report(token, "summary")], ["history", () => history(token)],
      ["action", () => action(token, "NOTE", target.id, { text: "x" })], ["draft", () => draft(token, "MARK_DONE", target.id)],
      ["snapshot", () => sql`select public.dpdp_ai_link_read(${token})`],
    ]
    for (const [name, run] of everything(link.token)) expect(await refuse(run), name).toContain(LINK_GONE)
    expect(await actions(org.id)).toHaveLength(0)
    expect(await drafts(org.id)).toHaveLength(0)

    const second = await create(owner.email, { level: 1 })
    expect((await jobs(second.token)).length).toBe(31)
    expect((await revoke(owner.email, second.linkId)).ok).toBe(true)
    for (const [name, run] of everything(second.token)) expect(await refuse(run), name).toContain(LINK_GONE)
    expect(await actions(org.id)).toHaveLength(0)
    for (const bad of ["", "not-a-token", sha256(second.token), "a".repeat(64)]) expect(await refuse(() => context(bad))).toContain(LINK_GONE)
    // The log records the attempts, against the link when the hash matched.
    const begun = await logCall(second.token, "GET", "/context")
    expect(begun.linkId).toBe(second.linkId)
    expect((await logCall("a".repeat(64), "GET", "/context")).linkId).toBeNull()
  }, 240_000)

  test("hide_emails: everyone else's email becomes a role (rows) or [email hidden] (history); the person's own email is never hidden", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org } = await buildOrgWithStaff(suffix)

    const shown = await create(owner.email)
    const hidden = await create(owner.email, { hideEmails: true })
    expect((await jobs(shown.token)).some((r) => r.by === staff.email)).toBe(true)
    const rows = await jobs(hidden.token)
    expect(rows.some((r) => r.by === staff.email)).toBe(false)
    const shownStaffJob = (await jobs(shown.token)).find((x) => x.by === staff.email)!
    const staffJob = rows.find((r) => r.id === shownStaffJob.id)!
    expect(staffJob.by).toBe("Customer data")
    expect(rows.filter((r) => r.byIsYou).every((r) => r.by === owner.email)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(staff.email)
    expect(JSON.stringify(await report(hidden.token, "by-person"))).not.toContain(staff.email)
    expect(JSON.stringify(await report(hidden.token, "by-person"))).toContain("Customer data")

    // History: the wizard's "named <staff>" lines are masked; the owner's own address stays.
    const hist = await history(hidden.token)
    const text = JSON.stringify(hist)
    expect(text).not.toContain(staff.email)
    expect(text).toContain("[email hidden]")
    expect(text).toContain(owner.email)
    expect(JSON.stringify(await history(shown.token))).toContain(staff.email)
    const detail = await job(hidden.token, staffJob.id)
    expect(JSON.stringify(detail)).not.toContain(staff.email)
    // The snapshot page (0607's reader) honours it too.
    const snap = (await sql<{ r: { rows: Array<{ by: string | null }>; link: { hideEmails: boolean } } }[]>`select public.dpdp_ai_link_read(${hidden.token}) as r`)[0].r
    expect(snap.link.hideEmails).toBe(true)
    expect(snap.rows.some((r) => r.by === staff.email)).toBe(false)

    // From the staff member's side: their own email shows, the owner's is hidden.
    const staffHidden = await create(staff.email, { hideEmails: true })
    const ctx = await context(staffHidden.token)
    expect(ctx.viewer.email).toBe(staff.email)
    const staffRows = await jobs(staffHidden.token)
    expect(staffRows.length).toBeGreaterThan(0)
    for (const r of staffRows) expect(r.by === staff.email || r.isGroup).toBe(true)
    const staffHist = JSON.stringify(await history(staffHidden.token))
    expect(staffHist).not.toContain(owner.email)
    for (const m of staffHist.match(EMAIL_RE) ?? []) expect(m).toBe(staff.email)
    expect((await context(staffHidden.token)).org.id).toBe(org.id)
  }, 240_000)

  test("every call is logged: begin/result rows, the per-minute count grows, 'Your AI links' shows callCount and lastUsedAt; a finished row cannot be re-finished", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(suffix)
    const link = await create(owner.email)
    expect((await list(owner.email))[0]).toMatchObject({ callCount: 0, lastUsedAt: null })

    const first = await logCall(link.token, "GET", "/context")
    expect(first).toMatchObject({ linkId: link.linkId, callsLastMinute: 1, limitPerMinute: 120 })
    expect((await logResult(first.callId, 200, 512)).ok).toBe(true)
    expect((await logResult(first.callId, 500, 1)).ok).toBe(false) // set once, never rewritten
    const second = await logCall(link.token, "GET", "/jobs?")
    expect(second.callsLastMinute).toBe(2)
    const third = await logCall(link.token, "POST", "/actions")
    expect(third.callsLastMinute).toBe(3)
    await logResult(third.callId, 403, null)

    const logged = await calls(org.id)
    expect(logged).toHaveLength(3)
    const byId = new Map(logged.map((c) => [c.id, c]))
    expect(byId.get(first.callId)).toMatchObject({ method: "GET", path: "/context", status: 200, bytes: 512, linkId: link.linkId })
    expect(byId.get(first.callId)?.finishedAt).not.toBeNull()
    expect(byId.get(second.callId)).toMatchObject({ status: null, finishedAt: null })
    expect(byId.get(third.callId)).toMatchObject({ method: "POST", path: "/actions", status: 403 })
    for (const c of logged) expect(c.path).not.toContain(link.token)

    const listed = (await list(owner.email)).find((l) => l.id === link.linkId)!
    expect(listed.callCount).toBe(3)
    expect(listed.lastUsedAt).not.toBeNull()
    expect((await context(link.token)).link.callCount).toBe(3)
  }, 240_000)

  test("filters, reports and law are over this view only: part / status / late / today / mine / nobody; summary counts equal the rows; law lists the citing jobs with the in-force fact", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { owner, staff, org } = await buildOrgWithStaff(suffix)
    const link = await create(owner.email, { level: 1 })
    const all = await jobs(link.token)
    expect(all).toHaveLength(31)

    for (const r of await jobs(link.token, { part: 1 })) expect(r.part).toBe(1)
    expect((await jobs(link.token, { part: "4" })).every((r) => r.part === 4)).toBe(true)
    expect(await refuse(() => jobs(link.token, { part: 9 }))).toContain("part must be")
    expect(await refuse(() => jobs(link.token, { status: "weird" }))).toContain("status must be")
    for (const r of await jobs(link.token, { today: true })) expect(r.requiredToday).toBe(true)
    expect((await jobs(link.token, { today: true })).length).toBeGreaterThan(0)
    for (const r of await jobs(link.token, { nobody: true })) { expect(r.by).toBeNull(); expect(r.isGroup).toBe(false) }
    expect((await jobs(link.token, { nobody: true })).length).toBeGreaterThan(0)
    // Nothing is late on a fresh org; make one late and it shows up.
    expect(await jobs(link.token, { late: true })).toHaveLength(0)
    const victim = all.find((r) => !r.isGroup && !r.yes && !r.na)!
    await withDpdpContext({ orgId: org.id }, (tx) => tx.update(dpdpObligation).set({ dueOn: "2026-01-01" }).where(eq(dpdpObligation.id, victim.id)))
    const late = await jobs(link.token, { late: true })
    expect(late.map((r) => r.id)).toEqual([victim.id])
    expect(late[0].status).toBe("late")
    expect(late[0].daysLate).toBeGreaterThan(200)
    expect((await jobs(link.token, { status: "late" })).map((r) => r.id)).toEqual([victim.id])
    expect((await jobs(link.token, { status: "open" })).every((r) => !r.yes && !r.na)).toBe(true)
    const staffLink = await create(staff.email)
    const mine = await jobs(staffLink.token, { mine: true })
    expect(mine.length).toBeGreaterThan(0)
    for (const r of mine) { expect(r.by).toBe(staff.email); expect(r.byIsYou).toBe(true) }
    expect((await jobs(staffLink.token)).length).toBeLessThan(31)

    const summary = (await report(link.token, "summary")).summary as { total: number; late: number; done: number; open: number; notApplicable: number; byPart: Array<{ part: number; total: number }> }
    expect(summary.total).toBe(all.filter((r) => !r.na).length)
    expect(summary.late).toBe(1)
    expect(summary.byPart.map((p) => p.part)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(summary.byPart.reduce((n, p) => n + p.total, 0)).toBe(summary.total)
    const people = (await report(link.token, "by-person")).people as Array<{ who: string; late: number; lateJobs: Array<{ id: string }> }>
    expect(people.find((p) => p.lateJobs.some((j) => j.id === victim.id))?.late).toBe(1)
    expect(people.some((p) => p.who === "nobody yet")).toBe(true)
    const parts = (await report(link.token, "by-part")).parts as Array<{ part: number; jobs: Array<{ id: string }> }>
    expect(parts.flatMap((p) => p.jobs).length).toBe(31)
    const laws = (await report(link.token, "by-law")).laws as Array<{ code: string; total: number }>
    expect(laws.some((l) => l.code === "d:§8(9)")).toBe(true)

    const go = await law(link.token, "d:§8(9)")
    expect(go.inForceToday).toBe(false)
    expect(go.legalDuty).toBe(true)
    expect(go.jobs.length).toBeGreaterThan(0)
    for (const j of go.jobs) expect(all.find((r) => r.id === j.id)?.lawCodes).toContain("d:§8(9)")
    expect((await law(link.token, "s:R5(9)")).inForceToday).toBe(true)
    expect((await law(link.token, "g:")).legalDuty).toBe(false)
    expect(await refuse(() => law(link.token, "8(9)"))).toContain("A law code looks like")

    const one = await job(link.token, victim.id)
    expect(one.id).toBe(victim.id)
    expect(one.plainText).toBeTruthy()
    expect(one.emailsSent).toBe(0)
    expect(Array.isArray(one.history)).toBe(true)
  }, 240_000)
})
