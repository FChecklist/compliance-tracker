/// <reference types="bun-types" />
// drizzle/0666: the person's own page gets a due-date control (owner), a note control (anyone who can see the job), and a hardened
// "doesn't apply" (a finished job is refused). Exercised over the real database the way dpdp-browser-rpc-step3.test.ts exercises 0605: a Supabase
// Auth JWT is stood in for by the request.jwt.claims GUC, one transaction per request. Skipped without DATABASE_URL.
// Load-bearing assertions:
//   * dpdp_set_due_date is owner-only, refuses a finished or not-applicable job, keeps to the 30-days-back / 400-days-ahead window, writes exactly one
//     obligation_due_changed event, and the event chain still verifies;
//   * dpdp_add_note reaches History as the words written for anyone who can SEE the job, and a job a staff member cannot see is "Job not found" (never
//     "not allowed", which would confirm the id exists); empty and over-long notes are refused;
//   * dpdp_mark_not_applicable no longer flips a finished job to "not applicable" (it used to drop a real Yes from the counts);
//   * cross-tenant: the owner of one organisation gets "Job not found" for another organisation's job on every one of them.
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
const { db, dpdpIdentity, dpdpIdentityEmail, dpdpObligation } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
const { eq } = await import("drizzle-orm")

const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

type Row = { id: string; what: string; by: string | null; isGroup: boolean; yes: boolean; na: boolean; due: string; dependsOnObligationId: string | null }
type Page = { org: { id: string }; viewer: { email: string; kind: string }; rows: Row[] }
type HistoryEntry = { kind: string; summary: string; detail: string | null; actorLabel: string }

async function asEmail<T>(email: string, run: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ email })}, true)`
    return run(tx as unknown as typeof sql)
  }) as Promise<T>
}
const myPage = (email: string): Promise<Page> => asEmail(email, async (tx) => (await tx<{ p: Page }[]>`select public.dpdp_my_page() as p`)[0].p)
const setDue = (email: string, id: string, dueOn: string | null) => asEmail(email, async (tx) => (await tx<{ r: { ok: boolean; dueOn: string } }[]>`select public.dpdp_set_due_date(${id}, ${dueOn}::date) as r`)[0].r)
const addNote = (email: string, id: string, text: string | null) => asEmail(email, async (tx) => (await tx<{ r: { ok: boolean } }[]>`select public.dpdp_add_note(${id}, ${text}) as r`)[0].r)
const markDone = (email: string, id: string) => asEmail(email, async (tx) => (await tx<{ r: { ok: boolean } }[]>`select public.dpdp_mark_done(${id}) as r`)[0].r)
const assign = (email: string, id: string, to: string) => asEmail(email, async (tx) => (await tx<{ r: { ok: boolean } }[]>`select public.dpdp_assign_person(${id}, ${to}) as r`)[0].r)
const markNa = (email: string, id: string, reason: string | null) => asEmail(email, async (tx) => (await tx<{ r: { ok: boolean } }[]>`select public.dpdp_mark_not_applicable(${id}, ${reason}) as r`)[0].r)
const history = (email: string, orgId: string) => asEmail(email, async (tx) => (await tx<{ r: HistoryEntry[] }[]>`select public.dpdp_org_history(${orgId}, ${50}::int) as r`)[0].r)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
async function refusal(run: () => Promise<unknown>): Promise<{ message: string; code?: string }> {
  try { await run() } catch (e) { return { message: message(e), code: (e as { code?: string }).code } }
  throw new Error("expected the database to refuse this, and it did not")
}

async function seedIdentity(tag: string) {
  const email = `wo-page-controls-${tag}@example.test`
  const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
  await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
  return { identityId: identity.id, email }
}
async function buildOrg(tag: string) {
  const owner = await seedIdentity(`owner-${tag}`)
  const org = await createDpdpOrganisation({ identityId: owner.identityId, name: `Page controls ${tag}`, product: "firm" })
  await instantiateObligationsForOrg(org.id, owner.identityId)
  return { owner, org }
}
const openJob = (p: Page, except: string[] = []): Row => {
  const r = p.rows.find((x) => !x.yes && !x.na && !x.isGroup && !x.dependsOnObligationId && !except.includes(x.id))
  expect(r).toBeDefined()
  return r!
}
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10)

d("drizzle/0666: the page's due-date and note controls, and a 'doesn't apply' that respects a finished job", () => {
  test("due date: owner only; the date is stored, one event is written, the window and the finished/not-applicable refusals hold, and the chain still verifies", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(tag)
    const staff = await seedIdentity(`staff-${tag}`)
    const page = await myPage(owner.email)
    const job = openJob(page)
    const target = inDays(45)

    const res = await setDue(owner.email, job.id, target)
    expect(res).toEqual({ ok: true, dueOn: target })
    const stored = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, job.id) }))
    expect(String(stored?.dueOn).slice(0, 10)).toBe(target)
    const ev = (await history(owner.email, org.id))[0]
    expect(ev).toMatchObject({ kind: "obligation_due_changed", summary: `Set "${job.what}" due on ${target}`, detail: `It was due on ${job.due}`, actorLabel: owner.email })

    // the window: 30 days back and 400 ahead, India time
    for (const bad of [inDays(-31), inDays(401)]) {
      const r = await refusal(() => setDue(owner.email, job.id, bad))
      expect(r.message).toContain("Pick a date from")
      expect(r.code).toBe("22023")
    }
    expect((await refusal(() => setDue(owner.email, job.id, null))).message).toBe("A date is required")

    // only the owner: a person the job is given to may not move its date
    await assign(owner.email, job.id, staff.email)
    const r = await refusal(() => setDue(staff.email, job.id, inDays(10)))
    expect(r).toMatchObject({ message: "Only the owner can do this", code: "42501" })

    // a finished job and a not-applicable job keep their dates
    const other = openJob(await myPage(owner.email), [job.id])
    await markDone(owner.email, other.id)
    expect((await refusal(() => setDue(owner.email, other.id, inDays(10)))).message).toBe("Already closed")
    const third = openJob(await myPage(owner.email), [job.id, other.id])
    await markNa(owner.email, third.id, "not for us")
    expect((await refusal(() => setDue(owner.email, third.id, inDays(10)))).message).toBe("Doesn't apply")

    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 120_000)

  test("note: the words reach History; a person the job is given to can add one; a job a staff member cannot see is 'not found'; empty and over-long are refused", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(tag)
    const staff = await seedIdentity(`staff-${tag}`)
    const stranger = await seedIdentity(`stranger-${tag}`)
    const page = await myPage(owner.email)
    // The job given to the staff member must not carry a role tag (Grievance Officer, coordinator, CA): the page treats the holder of one as that role, who sees the
    // whole organisation. "Write down where it is kept" belongs to a data area, so the person stays plain staff.
    const plain = page.rows.find((x) => /^Write down where it is kept/.test(x.what) && !x.yes && !x.na && !x.isGroup && !x.dependsOnObligationId)
    expect(plain).toBeDefined()
    const mine = plain!
    const theirs = openJob(page, [mine.id])
    await assign(owner.email, mine.id, staff.email)

    expect(await addNote(owner.email, theirs.id, "  The signed copy is with the CA.  ")).toEqual({ ok: true })
    expect((await history(owner.email, org.id))[0]).toMatchObject({ kind: "obligation_note_added", summary: `Added a note to "${theirs.what}"`, detail: "The signed copy is with the CA.", actorLabel: owner.email })

    // the person the job is given to may note it
    expect(await addNote(staff.email, mine.id, "On it — Friday.")).toEqual({ ok: true })
    // ...but not a job that is not theirs and not in a group they are in: it does not exist for them
    const hidden = await refusal(() => addNote(staff.email, theirs.id, "Not mine."))
    expect(hidden).toMatchObject({ message: "Job not found", code: "P0002" })
    // someone with no membership at all: the same words
    expect((await refusal(() => addNote(stranger.email, mine.id, "hello"))).message).toBe("Job not found")

    expect((await refusal(() => addNote(owner.email, theirs.id, "   "))).message).toBe("A note needs some words")
    expect((await refusal(() => addNote(owner.email, theirs.id, null))).message).toBe("A note needs some words")
    expect((await refusal(() => addNote(owner.email, theirs.id, "x".repeat(1001)))).message).toContain("1000 characters at most")
    expect(await addNote(owner.email, theirs.id, "x".repeat(1000))).toEqual({ ok: true })

    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 120_000)

  test("'doesn't apply' no longer turns a finished job into 'not applicable'; an open one still can, with the reason kept", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(tag)
    const page = await myPage(owner.email)
    const done = openJob(page)
    await markDone(owner.email, done.id)
    const r = await refusal(() => markNa(owner.email, done.id, "changed my mind"))
    expect(r).toMatchObject({ message: "Already closed", code: "P0001" })
    const after = (await myPage(owner.email)).rows.find((x) => x.id === done.id)!
    expect(after).toMatchObject({ yes: true, na: false })

    const open = openJob(await myPage(owner.email), [done.id])
    expect(await markNa(owner.email, open.id, "No cameras anywhere.")).toEqual({ ok: true })
    const entry = (await history(owner.email, org.id))[0]
    expect(entry).toMatchObject({ kind: "obligation_not_my_job", detail: "No cameras anywhere." })
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 120_000)

  test("a 'submitted' job is finished too: its date, its owner and its Yes are all left alone", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(tag)
    const job = openJob(await myPage(owner.email))
    const before = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, job.id) }))
    // Through the tenant-scoped connection: a bare `sql` update is filtered by row-level security and would change nothing, silently.
    await withDpdpContext({ orgId: org.id }, (tx) => tx.update(dpdpObligation).set({ state: "submitted" }).where(eq(dpdpObligation.id, job.id)))
    expect((await myPage(owner.email)).rows.find((x) => x.id === job.id)).toMatchObject({ yes: true, na: false })
    expect((await refusal(() => setDue(owner.email, job.id, inDays(10)))).message).toBe("Already closed")
    expect((await refusal(() => markNa(owner.email, job.id, "changed my mind"))).message).toBe("Already closed")
    expect((await refusal(() => assign(owner.email, job.id, "someone.else@example.test"))).message).toBe("Already closed")
    const row = await withDpdpContext({ orgId: org.id }, (tx) => tx.query.dpdpObligation.findFirst({ where: eq(dpdpObligation.id, job.id) }))
    expect(row?.state).toBe("submitted")
    expect(String(row?.dueOn).slice(0, 10)).toBe(job.due)
    expect(row?.assignedPersonId ?? null).toBe(before?.assignedPersonId ?? null) // "assign" must not have moved it, and must not have put it back to 'open'
    // a note is still welcome on a finished job
    expect(await addNote(owner.email, job.id, "Filed with the CA on Monday.")).toEqual({ ok: true })
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 120_000)

  test("the date window is inclusive at both ends: 30 days back and 400 days ahead (India time) are accepted, one further is not", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const { owner } = await buildOrg(tag)
    const job = openJob(await myPage(owner.email))
    expect(await setDue(owner.email, job.id, inDays(-30))).toEqual({ ok: true, dueOn: inDays(-30) })
    expect(await setDue(owner.email, job.id, inDays(400))).toEqual({ ok: true, dueOn: inDays(400) })
    expect((await refusal(() => setDue(owner.email, job.id, inDays(401)))).code).toBe("22023")
    expect((await refusal(() => setDue(owner.email, job.id, inDays(-31)))).code).toBe("22023")
  }, 120_000)

  test("a note or a reason of only line breaks and tabs is empty, and a reason is capped at 1000 characters (it lands in the permanent history)", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(tag)
    const page = await myPage(owner.email)
    const job = openJob(page)
    expect((await refusal(() => addNote(owner.email, job.id, "\n\t \r\n"))).message).toBe("A note needs some words")
    const long = await refusal(() => markNa(owner.email, job.id, "y".repeat(1001)))
    expect(long).toMatchObject({ message: "A reason can be 1000 characters at most", code: "22023" })
    expect((await myPage(owner.email)).rows.find((x) => x.id === job.id)).toMatchObject({ yes: false, na: false })
    expect(await markNa(owner.email, job.id, "\u{1F600}".repeat(600))).toEqual({ ok: true }) // 600 characters, 2400 bytes: characters are what count
    expect((await verifyDpdpEventChain(org.id)).ok).toBe(true)
  }, 120_000)

  test("History: a staff member reads only what they did themselves; the owner reads everything", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const { owner, org } = await buildOrg(tag)
    const staff = await seedIdentity(`staff-${tag}`)
    const page = await myPage(owner.email)
    const plain = page.rows.find((x) => /^Write down where it is kept/.test(x.what) && !x.yes && !x.na && !x.isGroup && !x.dependsOnObligationId)!
    const other = openJob(page, [plain.id])
    await assign(owner.email, plain.id, staff.email)
    await addNote(owner.email, other.id, "Owner-only: the grievance was about a named employee.")
    await addNote(staff.email, plain.id, "Staff: list is with HR.")

    const seenByStaff = await history(staff.email, org.id)
    expect(seenByStaff.length).toBeGreaterThan(0)
    expect(seenByStaff.every((e) => e.actorLabel === staff.email)).toBe(true)
    expect(seenByStaff.some((e) => e.detail === "Staff: list is with HR.")).toBe(true)
    expect(seenByStaff.some((e) => (e.detail ?? "").startsWith("Owner-only"))).toBe(false)

    const seenByOwner = await history(owner.email, org.id)
    expect(seenByOwner.some((e) => (e.detail ?? "").startsWith("Owner-only"))).toBe(true)
    expect(seenByOwner.some((e) => e.detail === "Staff: list is with HR.")).toBe(true)
  }, 120_000)

  test("cross-tenant: the owner of one organisation gets 'Job not found' for another organisation's job, on every control", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const a = await buildOrg(`a-${tag}`)
    const b = await buildOrg(`b-${tag}`)
    const jobOfB = openJob(await myPage(b.owner.email))
    for (const run of [
      () => setDue(a.owner.email, jobOfB.id, inDays(10)),
      () => addNote(a.owner.email, jobOfB.id, "hello"),
      () => markNa(a.owner.email, jobOfB.id, "no"),
      () => assign(a.owner.email, jobOfB.id, "x@example.test"),
    ]) {
      expect((await refusal(run)).message).toBe("Job not found")
    }
    // and nothing of B's changed
    const stillOpen = (await myPage(b.owner.email)).rows.find((x) => x.id === jobOfB.id)!
    expect(stillOpen).toMatchObject({ yes: false, na: false, due: jobOfB.due })
  }, 120_000)
})
