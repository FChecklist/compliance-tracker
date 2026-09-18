/// <reference types="bun-types" />
// Route-level proof of the 2026-09-18 HIGH-severity fix (owner-flagged): GET
// used to answer the task directly, so an email scanner/prefetcher (Gmail,
// Outlook, and most corporate security gateways all prefetch links) could
// mark a task answered before a human ever opened the email. This test
// exercises the actual exported GET/POST route handlers (not just the
// service layer, which dpdp-task-service.test.ts already covers) against the
// real, live database, proving: GET alone never answers the task, no matter
// how many times it's called; only a real POST does.
import { beforeAll, describe, expect, mock, test } from "bun:test"

await mock.module("@/lib/email", () => ({
  FROM: "test@example.test",
  sendEmail: async () => {},
  emailTemplate: (title: string, body: string) => `${title}: ${body}`,
  notifyAssigned: async () => {},
  notifyOverdue: async () => {},
  notifyDeadlineApproaching: async () => {},
  notifyNewComment: async () => {},
}))

const { GET, POST } = await import("./route")
const { createTask, issueTaskEmailToken } = await import("@/lib/services/dpdp-task-service")
const { db, dpdpOrganisation, dpdpIdentity, dpdpIdentityEmail, dpdpMembership, dpdpLibraryVersion, dpdpObligationTemplate, dpdpObligation, dpdpTask } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

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

function call(handler: typeof GET, token: string) {
  const req = new Request(`https://veridian-aios.com/api/dpdp/task-link/${token}`, { method: handler === POST ? "POST" : "GET" })
  return handler(req, { params: Promise.resolve({ token }) })
}

d("task-link route: GET renders, POST records (2026-09-18 security fix)", () => {
  let orgId: string
  let identityId: string
  let membershipId: string
  let taskId: string

  beforeAll(async () => {
    if (!hasDb) return
    const suffix = crypto.randomUUID().slice(0, 8)
    const [org] = await db.insert(dpdpOrganisation).values({ name: `Task Link Route Test ${suffix}`, slug: `task-link-route-${suffix}` }).returning()
    orgId = org.id
    const email = `task-link-route-${suffix}@example.test`
    const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
    identityId = identity.id
    await db.insert(dpdpIdentityEmail).values({ identityId, email, isPrimary: true })

    await withDpdpContext({ orgId }, async (tx) => {
      const [membership] = await tx.insert(dpdpMembership).values({ identityId, orgId, level: "owner", joinedVia: "created" }).returning()
      membershipId = membership.id
      const [lib] = await tx.insert(dpdpLibraryVersion).values({ version: `route-${suffix}`, releasedOn: new Date().toISOString().slice(0, 10) }).returning()
      const [tpl] = await tx.insert(dpdpObligationTemplate).values({ libraryVersionId: lib.id, key: `route_${suffix}`, name: "Route test obligation", plainText: "test", proofKind: "declaration", defaultDays: 30, answerableBy: "internal" }).returning()
      const [obligation] = await tx.insert(dpdpObligation).values({ orgId, templateId: tpl.id, libraryVersionUsed: lib.id, dueOn: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) }).returning()
      const task = await createTask({ orgId, obligationId: obligation.id, seq: 1, text: "Route test task", optionYes: "Yes", optionNo: "No" }, tx)
      taskId = task.id
    })
  }, 45_000)

  test("GET (an email scanner/prefetcher) renders a confirmation page and does NOT answer the task, any number of times", async () => {
    if (!hasDb) return
    const token = await issueTaskEmailToken(orgId, taskId, membershipId, identityId, "yes")

    for (let i = 0; i < 3; i++) {
      const res = await call(GET, token.raw)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain("Confirm your answer")
      expect(html).not.toContain("Recorded")
    }

    const taskAfterGets = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpTask.findFirst({ where: eq(dpdpTask.id, taskId) }))
    expect(taskAfterGets!.answer).toBeNull()
    expect(taskAfterGets!.answeredAt).toBeNull()
  }, 45_000)

  test("POST (the confirmation button's real form submit) answers the task; a second POST is refused; GET afterwards reports it used, not a fresh confirm page", async () => {
    if (!hasDb) return
    const token = await issueTaskEmailToken(orgId, taskId, membershipId, identityId, "no")

    const postRes = await call(POST, token.raw)
    expect(postRes.status).toBe(200)
    const postHtml = await postRes.text()
    expect(postHtml).toContain("Recorded")
    expect(postHtml).toContain(`"no"`)

    const task = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpTask.findFirst({ where: eq(dpdpTask.id, taskId) }))
    expect(task!.answer).toBe("no")
    expect(task!.answeredVia).toBe("email")

    const secondPost = await call(POST, token.raw)
    const secondHtml = await secondPost.text()
    expect(secondHtml).toContain("already been used")

    const getAfterSpend = await call(GET, token.raw)
    const getAfterSpendHtml = await getAfterSpend.text()
    expect(getAfterSpendHtml).toContain("already been used")
    expect(getAfterSpendHtml).not.toContain("Confirm your answer")
  }, 45_000)

  test("an invalid token GETs a plain 'not valid' page, not a server error", async () => {
    if (!hasDb) return
    const res = await call(GET, "not-a-real-token")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("not valid")
  }, 45_000)
})
