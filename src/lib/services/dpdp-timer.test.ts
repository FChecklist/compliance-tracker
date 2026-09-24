/// <reference types="bun-types" />
// WO-DPDP-011 Step 4: the Supabase-timer SQL (drizzle/0606) exercised over
// the real database, the same way dpdp-browser-rpc.test.ts exercises 0604:
// one transaction per call (DATABASE_URL goes through the transaction-mode
// pooler, so session state does not survive a statement), a transaction-
// local set_config('request.jwt.claims') where a browser RPC needs one,
// manual try/catch instead of expect().rejects (bun 1.3.14 matcher hang),
// 60s timeouts, @example.test seed data. The load-bearing assertions:
//   * one digest PER MEMBERSHIP, never per identity (one person, two orgs,
//     two entries, each with only that org's jobs);
//   * a staff member's digest holds only their own jobs;
//   * escalation flags follow §2.5 exactly (14/30, halved to 7/15 when a
//     job is required by today's law) and a 30-days-late job reaches the
//     owner's own digest by name;
//   * unsubscribe drops the membership to statutory-only, persisted;
//   * dpdp_my_page's `sent` reads a real recorded send (no more 0);
//   * apply_email_action refuses a wrong-org token at mint time, an
//     expired token, a reused token (refusal logged), and on success
//     writes exactly one event that still verifies in the hash chain.
//
// NOT RUN by the session that wrote it (no database reachable there) --
// written to pass first time against a database with 0606 applied; if it
// fails on "function dpdp.build_monday_digests does not exist", 0606 has
// not been applied yet.
import { afterAll, describe, expect, test } from "bun:test"
import type { AreaAssignment } from "./dpdp-onepage-service"

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
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation, dpdpEvent, dpdpObligationGroupAnswer } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

type Escalation = { red: boolean; ccCoordinator: boolean; ownerNamed: boolean; coordinatorNow: boolean; relationshipOwner: boolean; ccThresholdDays: number; ownerThresholdDays: number }
type Job = { obligationId: string; key: string; what: string; dueOn: string; daysLate: number; late: boolean; requiredToday: boolean; isGroup: boolean; groupLabel: string | null; assigneeEmail: string | null; isMine: boolean; stuck: boolean; outsideParty: boolean; escalation: Escalation }
type Escalated = { obligationId: string; what: string; assigneeEmail: string | null; daysLate: number; reason: string | null; stuck: boolean }
type Digest = {
  membershipId: string; identityId: string; orgId: string; email: string; level: string; roleKind: string; weekKey: string; today: string
  unsubscribed: boolean; statutoryOnly: boolean; alreadySentThisWeek: boolean
  owners: Array<{ membershipId: string; email: string }>; coordinators: Array<{ membershipId: string; email: string }>
  jobs: Job[]; escalatedToMe: Escalated[]
}
type PageRow = { id: string; sent: number; yes: boolean }
type Page = { org: { id: string }; viewer: { email: string; kind: string }; rows: PageRow[] }

function message(e: unknown) { return e instanceof Error ? e.message : String(e) }

/** The TS mirror of §2.5 (render.ts computeEscalation) -- what every SQL flag must equal. */
function expectedEscalation(j: { daysLate: number; requiredToday: boolean; stuck: boolean; outsideParty: boolean }): Escalation {
  const ccThresholdDays = j.requiredToday ? 7 : 14
  const ownerThresholdDays = j.requiredToday ? 15 : 30
  const late = j.daysLate > 0
  return {
    red: late, ccCoordinator: (late && j.daysLate >= ccThresholdDays) || j.stuck, ownerNamed: late && j.daysLate >= ownerThresholdDays,
    coordinatorNow: j.stuck, relationshipOwner: j.outsideParty && late, ccThresholdDays, ownerThresholdDays,
  }
}

/** p_now at 12:00 UTC (17:30 IST) on `ymd` + `days`, so the IST calendar day is unambiguous. */
function nowAt(ymd: string, days: number): string {
  const t = new Date(`${ymd}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString()
}

async function digests(orgId: string, nowIso: string = new Date().toISOString()): Promise<Digest[]> {
  return sql.begin(async (tx) => {
    const [{ d }] = await tx<{ d: Digest[] }[]>`select dpdp.build_monday_digests(${nowIso}::timestamptz, ${orgId}) as d`
    return d
  }) as Promise<Digest[]>
}
async function myPage(email: string): Promise<Page> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    const [{ page }] = await tx<{ page: Page }[]>`select public.dpdp_my_page() as page`
    return page
  }) as Promise<Page>
}
async function recordSend(a: { orgId: string; membershipId: string; identityId: string; obligationIds: string[]; kind: string; periodKey: string; to: string; subject: string; status?: string }) {
  return sql.begin(async (tx) => {
    const [{ r }] = await tx<{ r: { id: string | null; unsubscribeToken?: string; duplicate: boolean } }[]>`
      select dpdp.record_email_send(${a.orgId}, ${a.membershipId}, ${a.identityId}, ${a.obligationIds}::text[], ${a.kind}, ${a.periodKey}, ${a.to}, ${a.subject}, ${a.status ?? "queued"}, null) as r`
    return r
  }) as Promise<{ id: string | null; unsubscribeToken?: string; duplicate: boolean }>
}
async function markResult(id: string, status: string, messageId: string | null = null, error: string | null = null) {
  await sql.begin(async (tx) => { await tx`select dpdp.mark_email_send_result(${id}, ${status}, ${messageId}, ${error})` })
}
async function issueTokens(membershipId: string, obligationIds: string[], ttl = "7 days") {
  return sql.begin(async (tx) => {
    const [{ t }] = await tx<{ t: Array<{ obligationId: string; done: string; cannot: string; neverHadAny: string | null }> }[]>`
      select dpdp.issue_email_action_tokens(${membershipId}, ${obligationIds}::text[], ${ttl}::interval, null) as t`
    return t
  }) as Promise<Array<{ obligationId: string; done: string; cannot: string; neverHadAny: string | null }>>
}
async function applyAction(token: string, answer: string): Promise<{ ok: boolean; reason?: string; obligationId?: string }> {
  return sql.begin(async (tx) => {
    const [{ r }] = await tx<{ r: { ok: boolean; reason?: string; obligationId?: string } }[]>`select public.dpdp_apply_email_action(${token}, ${answer}) as r`
    return r
  }) as Promise<{ ok: boolean; reason?: string; obligationId?: string }>
}
async function previewAction(token: string): Promise<{ ok: boolean; reason?: string; action?: string }> {
  return sql.begin(async (tx) => {
    const [{ r }] = await tx<{ r: { ok: boolean; reason?: string; action?: string } }[]>`select public.dpdp_preview_email_action(${token}) as r`
    return r
  }) as Promise<{ ok: boolean; reason?: string; action?: string }>
}
async function unsubscribe(token: string): Promise<{ ok: boolean; reason?: string }> {
  return sql.begin(async (tx) => {
    const [{ r }] = await tx<{ r: { ok: boolean; reason?: string } }[]>`select public.dpdp_unsubscribe(${token}) as r`
    return r
  }) as Promise<{ ok: boolean; reason?: string }>
}

async function seedIdentity(suffix: string) {
  const email = `wo011-timer-${suffix}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}

async function buildOrg(suffix: string, assignments: AreaAssignment[] = []) {
  const owner = await seedIdentity(`owner-${suffix}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `WO011 Timer ${suffix}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  const ownerMembership = await db.query.dpdpMembership.findFirst({ where: (m, { eq, and }) => and(eq(m.identityId, owner.identityId), eq(m.orgId, org.id)) })
  if (assignments.length) await completeOwnerFirstVisit(org.id, owner.identityId, "Owner", ownerMembership!.id, assignments)
  return { owner, org, ownerMembershipId: ownerMembership!.id }
}

async function eventCount(orgId: string): Promise<number> {
  return (await withDpdpContext({ orgId }, (tx) => tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, orgId) }))).length
}

d("WO-DPDP-011 Step 4: the Supabase timer", () => {
  test("one digest per MEMBERSHIP, never per identity: one person in two orgs gets two entries, each with only that org's jobs; staff see only their own jobs", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const staff = await seedIdentity(`staff-${suffix}`)
    const coord = await seedIdentity(`coord-${suffix}`)
    const a = await buildOrg(`a-${suffix}`, [
      { area: "Customer data", emails: [staff.email], na: false },
      { area: "DPDP coordinator", emails: [coord.email], na: false },
    ])
    const b = await buildOrg(`b-${suffix}`, [{ area: "Staff records", emails: [staff.email], na: false }])

    const inA = await digests(a.org.id)
    const inB = await digests(b.org.id)
    const staffA = inA.find((x) => x.email === staff.email)
    const staffB = inB.find((x) => x.email === staff.email)
    expect(staffA).toBeDefined()
    expect(staffB).toBeDefined()
    expect(staffA!.identityId).toBe(staffB!.identityId)
    expect(staffA!.membershipId).not.toBe(staffB!.membershipId)
    expect(staffA!.orgId).toBe(a.org.id)
    expect(staffB!.orgId).toBe(b.org.id)
    // Exactly one entry per membership in each org.
    expect(inA.filter((x) => x.membershipId === staffA!.membershipId)).toHaveLength(1)
    expect(inB.filter((x) => x.membershipId === staffB!.membershipId)).toHaveLength(1)

    // Only their own jobs, from the right org: "Customer data" is 4 firm
    // jobs (firm-04/11/12/28), "Staff records" is 6 (firm-05/06/09/13/14/17).
    expect(staffA!.jobs).toHaveLength(4)
    expect(staffB!.jobs).toHaveLength(6)
    for (const j of [...staffA!.jobs, ...staffB!.jobs]) {
      expect(j.isMine).toBe(true)
      expect(j.assigneeEmail).toBe(staff.email)
      expect(j.isGroup).toBe(false)
      expect(j.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const idsA = new Set(staffA!.jobs.map((j) => j.obligationId))
    expect(staffB!.jobs.some((j) => idsA.has(j.obligationId))).toBe(false)
    expect(staffA!.jobs.filter((j) => j.requiredToday).map((j) => j.key)).toEqual(["firm-11"])
    expect(staffA!.roleKind).toBe("staff")
    expect(staffA!.coordinators.map((c) => c.email)).toEqual([coord.email])
    expect(staffA!.owners.map((c) => c.email)).toEqual([a.owner.email])
    expect(staffA!.weekKey).toMatch(/^\d{4}-W\d{2}$/)
    expect(staffA!.unsubscribed).toBe(false)
    expect(staffA!.statutoryOnly).toBe(false)
    expect(staffA!.alreadySentThisWeek).toBe(false)

    // The coordinator is detected from the (auto-closed) "Name a DPDP
    // coordinator" job, and the owner sees every open, unblocked job with
    // the staff member's jobs flagged as not theirs.
    expect(inA.find((x) => x.email === coord.email)?.roleKind).toBe("coord")
    const ownerA = inA.find((x) => x.email === a.owner.email)!
    expect(ownerA.roleKind).toBe("owner")
    expect(ownerA.jobs.length).toBeGreaterThan(staffA!.jobs.length)
    for (const id of idsA) expect(ownerA.jobs.find((j) => j.obligationId === id)?.isMine).toBe(false)
    // Blocked chain links (firm-30 depends on firm-29, firm-31 on firm-30)
    // get no email until the step before them is done.
    expect(ownerA.jobs.some((j) => j.key === "firm-30" || j.key === "firm-31")).toBe(false)
    // Nothing is escalated to anyone on day one.
    for (const x of inA) { expect(x.escalatedToMe).toEqual([]); for (const j of x.jobs) expect(j.escalation).toEqual(expectedEscalation(j)) }
  }, 60_000)

  test("escalation follows §2.5 exactly (14/30, halved to 7/15 for a job required by today's law) and a 30-days-late job names the owner in the owner's own digest", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const staff = await seedIdentity(`staff-${suffix}`)
    const coord = await seedIdentity(`coord-${suffix}`)
    const { owner, org } = await buildOrg(suffix, [
      { area: "Customer data", emails: [staff.email], na: false },
      { area: "DPDP coordinator", emails: [coord.email], na: false },
      { area: "Website firm", emails: [`web-${suffix}@example.test`], na: false },
    ])
    const base = (await digests(org.id)).find((x) => x.email === staff.email)!
    const required = base.jobs.find((j) => j.requiredToday)!
    const ordinary = base.jobs.find((j) => !j.requiredToday)!
    expect(required.key).toBe("firm-11")

    // 8 days past the required-today job's due date: it is copied to the
    // coordinator (7), an ordinary job 8 days late is not (14).
    const at8 = (await digests(org.id, nowAt(required.dueOn, 8))).find((x) => x.email === staff.email)!
    const r8 = at8.jobs.find((j) => j.obligationId === required.obligationId)!
    expect(r8.daysLate).toBe(8)
    expect(r8.escalation).toMatchObject({ red: true, ccCoordinator: true, ownerNamed: false, ccThresholdDays: 7, ownerThresholdDays: 15 })
    const o8 = at8.jobs.find((j) => j.obligationId === ordinary.obligationId)!
    if (o8.daysLate > 0 && o8.daysLate < 14) expect(o8.escalation).toMatchObject({ red: true, ccCoordinator: false, ownerNamed: false })
    // Late first: the first job in the list is the most late.
    expect(at8.jobs[0].daysLate).toBe(Math.max(...at8.jobs.map((j) => j.daysLate)))
    for (const j of at8.jobs) expect(j.escalation).toEqual(expectedEscalation(j))

    // 16 days past: the required-today job names the owner (15); the same
    // job, ordinary, would not until 30.
    const at16 = (await digests(org.id, nowAt(required.dueOn, 16))).find((x) => x.email === staff.email)!
    expect(at16.jobs.find((j) => j.obligationId === required.obligationId)!.escalation).toMatchObject({ ccCoordinator: true, ownerNamed: true })
    for (const j of at16.jobs) expect(j.escalation).toEqual(expectedEscalation(j))

    // 31 days past the ORDINARY job's due date: owner named, and the owner's
    // own digest carries it under "escalated to me" with the staff member
    // named; the coordinator's digest carries it too (it is >= 14).
    const all31 = await digests(org.id, nowAt(ordinary.dueOn, 31))
    const staff31 = all31.find((x) => x.email === staff.email)!
    const o31 = staff31.jobs.find((j) => j.obligationId === ordinary.obligationId)!
    expect(o31.daysLate).toBe(31)
    expect(o31.escalation).toMatchObject({ red: true, ccCoordinator: true, ownerNamed: true, ccThresholdDays: 14, ownerThresholdDays: 30 })
    for (const x of all31) for (const j of x.jobs) expect(j.escalation).toEqual(expectedEscalation(j))
    const owner31 = all31.find((x) => x.email === owner.email)!
    const toOwner = owner31.escalatedToMe.find((e) => e.obligationId === ordinary.obligationId)
    expect(toOwner).toBeDefined()
    expect(toOwner!.reason).toBe("late_owner")
    expect(toOwner!.assigneeEmail).toBe(staff.email)
    expect(toOwner!.daysLate).toBe(31)
    // An outside firm's late job reaches the owner as the relationship holder.
    const web = owner31.jobs.find((j) => j.key === "firm-15")!
    expect(web.outsideParty).toBe(true)
    if (web.daysLate > 0) {
      expect(web.escalation.relationshipOwner).toBe(true)
      expect(owner31.escalatedToMe.find((e) => e.obligationId === web.obligationId)?.reason).toBe("outside_party_silent")
    }
    const coord31 = all31.find((x) => x.email === coord.email)!
    expect(coord31.roleKind).toBe("coord")
    expect(coord31.escalatedToMe.find((e) => e.obligationId === ordinary.obligationId)?.reason).toBe("late_coordinator")
    // The staff member never sees anyone else's escalations.
    expect(staff31.escalatedToMe).toEqual([])
  }, 60_000)

  test("a recorded send shows up in dpdp_my_page's `sent`, makes the week idempotent, and unsubscribing drops the membership to statutory-only (persisted, chain intact)", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const staff = await seedIdentity(`staff-${suffix}`)
    const { owner, org } = await buildOrg(suffix, [{ area: "Customer data", emails: [staff.email], na: false }])
    const staffDigest = (await digests(org.id)).find((x) => x.email === staff.email)!
    const target = staffDigest.jobs[0]

    const rec = await recordSend({ orgId: org.id, membershipId: staffDigest.membershipId, identityId: staffDigest.identityId, obligationIds: [target.obligationId], kind: "monday_digest", periodKey: staffDigest.weekKey, to: staff.email, subject: "test" })
    expect(rec.duplicate).toBe(false)
    expect(rec.id).toBeTruthy()
    expect(rec.unsubscribeToken).toMatch(/^[0-9a-f]{64}$/)

    // Queued is not sent: the count stays 0 until the send is marked.
    let page = await myPage(owner.email)
    expect(page.rows.find((r) => r.id === target.obligationId)?.sent).toBe(0)
    await markResult(rec.id!, "sent", "resend_msg_1")
    page = await myPage(owner.email)
    expect(page.rows.find((r) => r.id === target.obligationId)?.sent).toBe(1)
    for (const r of page.rows) if (r.id !== target.obligationId) expect(r.sent).toBe(0)

    // Same membership, same week: refused as a duplicate, and the digest
    // says so, which is what stops a re-run double-sending.
    const again = await recordSend({ orgId: org.id, membershipId: staffDigest.membershipId, identityId: staffDigest.identityId, obligationIds: [target.obligationId], kind: "monday_digest", periodKey: staffDigest.weekKey, to: staff.email, subject: "test" })
    expect(again.duplicate).toBe(true)
    expect(again.id).toBeNull()
    expect((await digests(org.id)).find((x) => x.email === staff.email)!.alreadySentThisWeek).toBe(true)
    // A failed row does not block a retry.
    const other = staffDigest.jobs[1]
    const failed = await recordSend({ orgId: org.id, membershipId: staffDigest.membershipId, identityId: staffDigest.identityId, obligationIds: [other.obligationId], kind: "leak_clock", periodKey: `leak:x:${suffix}`, to: staff.email, subject: "t" })
    await markResult(failed.id!, "failed", null, "Resend 500")
    expect((await recordSend({ orgId: org.id, membershipId: staffDigest.membershipId, identityId: staffDigest.identityId, obligationIds: [other.obligationId], kind: "leak_clock", periodKey: `leak:x:${suffix}`, to: staff.email, subject: "t" })).duplicate).toBe(false)

    // Unsubscribe with the token from the email; a garbage token is refused.
    expect((await unsubscribe("not-a-token")).ok).toBe(false)
    const events0 = await eventCount(org.id)
    expect((await unsubscribe(rec.unsubscribeToken!)).ok).toBe(true)
    const after = (await digests(org.id)).find((x) => x.email === staff.email)!
    expect(after.unsubscribed).toBe(true)
    expect(after.statutoryOnly).toBe(true)
    // Unsubscribing twice is harmless and the owner is untouched.
    expect((await unsubscribe(rec.unsubscribeToken!)).ok).toBe(true)
    expect((await digests(org.id)).find((x) => x.email === owner.email)!.statutoryOnly).toBe(false)
    expect(await eventCount(org.id)).toBe(events0 + 2)
    const chain = await verifyDpdpEventChain(org.id)
    expect(chain.ok).toBe(true)
  }, 60_000)

  test("apply_email_action: wrong-org token refused at mint, expired and reused tokens refused (refusal logged), success writes exactly one event and the chain verifies; 'I can't' on a group job is a stuck escalation", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const staff = await seedIdentity(`staff-${suffix}`)
    const mate = await seedIdentity(`mate-${suffix}`)
    const coord = await seedIdentity(`coord-${suffix}`)
    const { org } = await buildOrg(suffix, [
      { area: "Customer data", emails: [staff.email], na: false },
      { area: "All staff", emails: [staff.email, mate.email], na: false },
      { area: "DPDP coordinator", emails: [coord.email], na: false },
    ])
    const other = await buildOrg(`other-${suffix}`)
    const staffDigest = (await digests(org.id)).find((x) => x.email === staff.email)!
    const individual = staffDigest.jobs.find((j) => !j.isGroup)!
    const group = staffDigest.jobs.find((j) => j.isGroup)!
    expect(group.groupLabel).toBe("All staff")

    // Membership binding at mint time: another org's owner cannot get a
    // token for this org's job, and a staff member cannot get one for a
    // job that is not theirs.
    let msg = ""
    try { await issueTokens(other.ownerMembershipId, [individual.obligationId]) } catch (e) { msg = message(e) }
    expect(msg).toContain("does not belong to membership")
    const notMine = (await digests(org.id)).find((x) => x.email === coord.email)!
    msg = ""
    try { await issueTokens(notMine.membershipId, [individual.obligationId]) } catch (e) { msg = message(e) }
    expect(msg).toContain("Not your job")

    // Expired: refused, and the refusal is a logged event.
    const events0 = await eventCount(org.id)
    const [expired] = await issueTokens(staffDigest.membershipId, [individual.obligationId], "-1 hour")
    expect((await previewAction(expired.done)).reason).toContain("expired")
    const exp = await applyAction(expired.done, "done")
    expect(exp.ok).toBe(false)
    expect(exp.reason).toContain("This link has expired")
    expect(await eventCount(org.id)).toBe(events0 + 1)

    // Success: exactly one event, the job is closed by the staff identity,
    // and the answer must match the token's own action.
    const [tokens] = await issueTokens(staffDigest.membershipId, [individual.obligationId])
    expect(tokens.obligationId).toBe(individual.obligationId)
    expect(tokens.done).toMatch(/^[0-9a-f]{64}$/)
    expect(tokens.neverHadAny).toBeNull()
    expect(await previewAction(tokens.done)).toMatchObject({ ok: true, action: "done", what: individual.what })
    expect((await applyAction(tokens.done, "cannot")).reason).toContain("does not match")
    const events1 = await eventCount(org.id)
    const ok = await applyAction(tokens.done, "done")
    expect(ok.ok).toBe(true)
    expect(ok.obligationId).toBe(individual.obligationId)
    expect(await eventCount(org.id)).toBe(events1 + 1)
    const closed = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, individual.obligationId) }))
    expect(closed?.state).toBe("closed")
    expect(closed?.closedBy).toBe(staffDigest.identityId)
    expect((await myPage(staff.email)).rows.find((r) => r.id === individual.obligationId)?.yes).toBe(true)

    // Reuse: refused, logged, nothing else changes; the preview says so too.
    const reused = await applyAction(tokens.done, "done")
    expect(reused.ok).toBe(false)
    expect(reused.reason).toContain("already been used")
    expect((await previewAction(tokens.done)).ok).toBe(false)
    expect(await eventCount(org.id)).toBe(events1 + 2)
    // The unused sibling token on a now-closed job is spent harmlessly.
    expect((await applyAction(tokens.cannot, "cannot")).reason).toContain("already marked done")

    // Group job: "I can't" records this member's private answer, bumps
    // progress, and shows up as a stuck escalation to the coordinator; the
    // member's own next digest no longer lists the job (they answered).
    const [g] = await issueTokens(staffDigest.membershipId, [group.obligationId])
    expect(g.neverHadAny).toMatch(/^[0-9a-f]{64}$/)
    expect((await applyAction(g.cannot, "cannot")).ok).toBe(true)
    const answer = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligationGroupAnswer.findFirst({ where: eq(dpdpObligationGroupAnswer.obligationId, group.obligationId) }))
    expect(answer?.answer).toBe("cannot")
    expect(answer?.membershipId).toBe(staffDigest.membershipId)
    const groupRow = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, group.obligationId) }))
    expect(groupRow?.progressDone).toBe(1)
    expect(groupRow?.state).not.toBe("closed")
    const later = await digests(org.id)
    expect(later.find((x) => x.email === staff.email)!.jobs.some((j) => j.obligationId === group.obligationId)).toBe(false)
    const mateView = later.find((x) => x.email === mate.email)!.jobs.find((j) => j.obligationId === group.obligationId)!
    expect(mateView.stuck).toBe(true)
    expect(mateView.escalation).toMatchObject({ coordinatorNow: true, ccCoordinator: true })
    expect(later.find((x) => x.email === coord.email)!.escalatedToMe.find((e) => e.obligationId === group.obligationId)?.reason).toBe("stuck")

    // Everything above re-hashes from JS, on top of the TS-written events.
    const chain = await verifyDpdpEventChain(org.id)
    expect(chain.ok).toBe(true)
    expect(chain.checked).toBeGreaterThanOrEqual(6)
  }, 60_000)

  test("legal_clocks returns the two rhythm-breakers only, and empty arrays when there are none", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const { org } = await buildOrg(suffix)
    const [{ c }] = await sql<{ c: { day: string; leaks: unknown[]; rights: unknown[] } }[]>`select dpdp.legal_clocks(now(), ${org.id}) as c`
    expect(c.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(c.leaks).toEqual([])
    expect(c.rights).toEqual([])
  }, 30_000)
})
