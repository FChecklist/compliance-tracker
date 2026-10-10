/// <reference types="bun-types" />
/* eslint-disable complexity -- one long, linear scenario per edition is the point of this file */
// WO-DPDP-015 (owner instruction 2026-09-28): the /dpdp-firm and
// /dpdp-institution editions, END TO END, for EVERY role, over the real
// database -- from a brand-new visitor opening their own organisation to the
// Monday morning digest and the external AI work link.
//
// Everything for one edition runs inside ONE transaction that is rolled back
// at the end (the RPCs are security-definer and the claims are transaction-
// local, exactly what PostgREST does per request), so this file leaves NO
// data behind -- unlike the older suites that commit @example.test orgs. A
// refusal is expected in several places; each is wrapped in a savepoint so
// the refusal does not abort the transaction. Every assertion re-reads
// persisted state (R74-RULING-03), never a success message.
//
// Roles covered per edition: new visitor (no membership yet), owner (boss /
// principal), Grievance Officer, DPDP coordinator, staff owning an area,
// staff in the group (all staff / teachers), the CA partner who set an org up
// for a client and the client's owner who confirms it. Each role: sees the
// right page kind and only its own jobs, acts through its own RPC, gets its
// own Monday digest, and reaches (or is refused by) the external AI work
// link at the right authority.
import { afterAll, describe, expect, test } from "bun:test"

async function probeDpdpDatabase(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false
  const postgres = (await import("postgres")).default
  for (let attempt = 1; attempt <= 4; attempt++) {
    const probe = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 15, idle_timeout: 1 })
    try {
      await probe`select 1`
      await probe.end({ timeout: 5 })
      return true
    } catch {
      try { await probe.end({ timeout: 5 }) } catch {}
      if (attempt < 4) await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}
const hasDb = await probeDpdpDatabase()
const d = hasDb ? describe : describe.skip
// The automation sets DPDP_REQUIRE_DB=1: an unreachable database is then a FAILURE, never a silent skip.
const requireDb = process.env.DPDP_REQUIRE_DB === "1"

const postgres = (await import("postgres")).default
const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
afterAll(async () => { try { await sql.end({ timeout: 5 }) } catch {} })

class Rollback extends Error {}
type Tx = typeof sql
// deno-lint-ignore no-explicit-any
type Json = any

function must(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${what}`)
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e) }

async function asEmail<T>(tx: Tx, email: string | null, run: () => Promise<T>): Promise<T> {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(email ? { email, role: "authenticated" } : {})}, true)`
  return run()
}
/** A refusal the database is meant to give: returns its message, and the transaction survives. */
async function refusal(tx: Tx, run: () => Promise<unknown>): Promise<string | null> {
  try {
    await (tx as unknown as { savepoint: (f: () => Promise<unknown>) => Promise<unknown> }).savepoint(async () => { await run() })
    return null
  } catch (e) {
    return message(e)
  }
}
const one = async (tx: Tx, email: string | null, q: (tx: Tx) => Promise<Json[]>, key: string): Promise<Json> => asEmail(tx, email, async () => (await q(tx))[0][key])

const myPage = (tx: Tx, email: string, orgId: string | null = null) => one(tx, email, (t) => t`select public.dpdp_my_page(${orgId}) as r`, "r")
const createMyOrg = (tx: Tx, email: string | null, name: string, product: string) => one(tx, email, (t) => t`select public.dpdp_create_my_org(${name}, ${product}) as r`, "r")
const markDone = (tx: Tx, email: string, id: string) => one(tx, email, (t) => t`select public.dpdp_mark_done(${id}) as r`, "r")
const ackWelcome = (tx: Tx, email: string, orgId: string) => one(tx, email, (t) => t`select public.dpdp_acknowledge_welcome(${orgId}) as r`, "r")
const answerGroup = (tx: Tx, email: string, id: string, answer: string) => one(tx, email, (t) => t`select public.dpdp_answer_group(${id}, ${answer}) as r`, "r")
const firstVisit = (tx: Tx, email: string, orgId: string, a: Json[]) => one(tx, email, (t) => t`select public.dpdp_complete_owner_first_visit(${orgId}, ${t.json(a)}) as r`, "r")
const createClientOrg = (tx: Tx, email: string, name: string, product: string, owner: string | null) => one(tx, email, (t) => t`select public.dpdp_create_client_org(${name}, ${product}, ${owner}) as r`, "r")
const orgSetup = (tx: Tx, email: string, orgId: string) => one(tx, email, (t) => t`select public.dpdp_org_setup(${orgId}) as r`, "r")
const confirmSetup = (tx: Tx, email: string, orgId: string) => one(tx, email, (t) => t`select public.dpdp_owner_confirm_setup(${orgId}) as r`, "r")
const myClients = (tx: Tx, email: string) => one(tx, email, (t) => t`select public.dpdp_my_clients() as r`, "r")
const digests = async (tx: Tx, orgId: string, nowIso: string): Promise<Json[]> => (await tx`select dpdp.build_monday_digests(${nowIso}::timestamptz, ${orgId}) as r`)[0].r
const createLink = (tx: Tx, email: string, orgId: string, level: number, hide = false) =>
  one(tx, email, (t) => t`select public.dpdp_ai_link_create(${level}, ${hide}, 1, 'editions-e2e', ${orgId}) as r`, "r")
const linkCtx = async (tx: Tx, token: string): Promise<Json> => (await tx`select public.dpdp_ai_link_context(${token}) as r`)[0].r
const linkJobs = async (tx: Tx, token: string): Promise<Json[]> => (await tx`select public.dpdp_ai_link_jobs(${token}, ${tx.json({})}) as r`)[0].r
const linkAction = async (tx: Tx, token: string, verb: string, jobId: string, value: Json) =>
  (await tx`select public.dpdp_ai_link_action(${token}, ${verb}, ${jobId}, ${tx.json(value)}) as r`)[0].r
const linkDraft = async (tx: Tx, token: string, verb: string, jobId: string) =>
  (await tx`select public.dpdp_ai_link_draft(${token}, ${verb}, ${jobId}, ${tx.json({})}) as r`)[0].r

const nowAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

type Edition = { product: "firm" | "institution"; group: string; go: string; coord: string; staffArea: string; ownerLabel: string }
const EDITIONS: Edition[] = [
  { product: "firm", group: "All staff", go: "Grievance Officer (responsible for DPDP policy)", coord: "DPDP coordinator", staffArea: "Customer data", ownerLabel: "boss" },
  { product: "institution", group: "Teachers", go: "Grievance Officer (responsible for DPDP policy)", coord: "DPDP coordinator", staffArea: "Admission office", ownerLabel: "principal" },
]

for (const ed of EDITIONS) {
  d(`${ed.product} edition (/dpdp-${ed.product}) -- every role, end to end, rolled back`, () => {
    test("new visitor -> owner -> every role -> Monday digest -> external AI link -> CA and client", async () => {
      const run = `e2e${Math.random().toString(36).slice(2, 8)}`
      const em = (who: string) => `${ed.product}-${who}-${run}@example.test`
      const ownerEmail = em(ed.ownerLabel)
      const goEmail = em("go")
      const coordEmail = em("coord")
      const staffEmail = em("staff")
      const member1 = em("member1")
      const member2 = em("member2")
      const caEmail = em("ca")
      const clientOwner = em("client-owner")

      await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Tx

        // ---- 0. A visitor who has not opened an organisation has nothing to see -----------------
        const noMember = await refusal(tx, () => myPage(tx, ownerEmail))
        must(noMember && /member/i.test(noMember), `a visitor with no organisation is refused the page (got: ${noMember})`)
        const anon = await refusal(tx, () => createMyOrg(tx, null, "Nobody Ltd", ed.product))
        must(anon?.includes("Sign in"), `opening an organisation needs a signed-in visitor (got: ${anon})`)
        must(await refusal(tx, () => createMyOrg(tx, ownerEmail, "   ", ed.product)), "an empty name is refused")
        must(await refusal(tx, () => createMyOrg(tx, ownerEmail, "X".repeat(121), ed.product)), "a 121-character name is refused")
        must(await refusal(tx, () => createMyOrg(tx, ownerEmail, "Bad Edition", "hospital")), "an unknown edition is refused")

        // ---- 1. The visitor opens their own organisation (the landing page's "Start free") ------
        const templates = Number((await tx`select count(*)::int as n from dpdp.obligation_template t join dpdp.library_version v on v.id = t.library_version_id and v.is_current where t.product is null or t.product = ${ed.product}`)[0].n)
        must(templates >= 20, `the ${ed.product} library has jobs (${templates})`)
        const orgName = `E2E ${ed.product} ${run}`
        const made = await createMyOrg(tx, ownerEmail, orgName, ed.product)
        must(made.ok && made.orgId && made.existing === false, "the organisation was made")
        must(made.jobs === templates, `all ${templates} ${ed.product} jobs were opened (got ${made.jobs})`)
        const again = await createMyOrg(tx, ownerEmail, orgName, ed.product)
        must(again.existing === true && again.orgId === made.orgId, "a double click returns the same organisation, not a second one")
        const orgId: string = made.orgId
        // Direct table reads go through row-level security like the app's own: the organisation's context, transaction-local.
        await tx`select set_config('app.dpdp_org_id', ${orgId}, true)`

        const stored = (await tx`select o.product, o.name, (select count(*)::int from dpdp.obligation ob where ob.org_id = o.id) jobs, (select count(*)::int from dpdp.membership m where m.org_id = o.id) members from dpdp.organisation o where o.id = ${orgId}`)[0]
        must(stored.product === ed.product && stored.name === orgName && stored.jobs === templates && stored.members === 1, "the organisation, its jobs and its one owner are stored")
        const membership = (await tx`select m.level, m.can_sign, m.state from dpdp.membership m where m.id = ${made.membershipId}`)[0]
        must(membership.level === "owner" && membership.can_sign === true && membership.state === "active", "the visitor is an active owner who can sign")

        // ---- 2. Owner: first visit, then the areas are named -----------------------------------
        const ownerPage = await myPage(tx, ownerEmail, orgId)
        must(ownerPage.viewer.kind === "owner" && ownerPage.org.product === ed.product, `the ${ed.ownerLabel} sees the owner page of a ${ed.product}`)
        must(ownerPage.rows.length === templates, "the owner sees every job")
        must(!ownerPage.viewer.firstVisitSeenAt, "the owner's first visit has not happened yet")

        const areas: Json[] = (await tx`select public.dpdp_areas_for_product(${ed.product}) as r`)[0].r
        const groupArea = areas.find((a) => a.isGroup)
        must(groupArea?.area === ed.group, `the ${ed.product} group area is "${ed.group}"`)
        const emailsFor = (area: string): string[] =>
          area === ed.go ? [goEmail] : area === ed.coord ? [coordEmail] : area === ed.staffArea ? [staffEmail] : area === ed.group ? [member1, member2] : []
        const assignments = areas.map((a) => ({ area: a.area, emails: emailsFor(a.area), na: false }))
        const fv = await firstVisit(tx, ownerEmail, orgId, assignments)
        must(fv.ok, "the owner's first visit was saved")
        must((await myPage(tx, ownerEmail, orgId)).viewer.firstVisitSeenAt, "the owner's first visit is remembered")

        // ---- 3. Each role sees the right page and only its own jobs ----------------------------
        const roles: Array<{ label: string; email: string; kind: string }> = [
          { label: "Grievance Officer", email: goEmail, kind: "go" },
          { label: "DPDP coordinator", email: coordEmail, kind: "coord" },
          { label: "staff owning an area", email: staffEmail, kind: "staff" },
          { label: "group member 1", email: member1, kind: "staff" },
          { label: "group member 2", email: member2, kind: "staff" },
        ]
        const pages: Record<string, Json> = {}
        for (const r of roles) {
          const p = await myPage(tx, r.email, orgId)
          pages[r.email] = p
          must(p.viewer.kind === r.kind, `${r.label} is a "${r.kind}" (got "${p.viewer.kind}")`)
          if (r.kind === "staff") {
            // Staff see only what is theirs: their own jobs and the group jobs they are in.
            must(p.rows.length > 0 && p.rows.length < templates, `${r.label} sees some jobs, not all (${p.rows.length} of ${templates})`)
            for (const row of p.rows) {
              must(row.by === r.email || row.isGroup || row.by === "a colleague", `${r.label} sees only own, group or masked-dependency jobs (saw "${row.what}" by ${row.by})`)
              must(!/@/.test(String(row.by ?? "")) || row.by === r.email, `${r.label} is shown nobody else's email (${row.by})`)
            }
          } else {
            // The Grievance Officer and the coordinator run the file: the whole organisation's jobs, their own marked.
            must(p.rows.length === templates, `${r.label} sees the whole file (${p.rows.length} of ${templates})`)
            must(p.rows.some((row: Json) => row.by === r.email), `${r.label} has jobs of their own on it`)
          }
          must((await ackWelcome(tx, r.email, orgId)).ok !== false, `${r.label} can acknowledge the welcome`)
        }
        must(
          pages[goEmail].rows.filter((row: Json) => row.by === goEmail).length === areas.find((a) => a.area === ed.go)!.jobs.length,
          "the Grievance Officer's own jobs are exactly the GO area",
        )

        // ---- 4. Each role acts through its own screen; the act persists ------------------------
        const ownRow = (email: string) => pages[email].rows.find((r: Json) => !r.isGroup && r.by === email && !r.yes)
        const doneIds = new Set<string>()
        for (const r of [roles[0], roles[1], roles[2]]) {
          const row = ownRow(r.email)
          // The firm's coordinator has one job ("Name a DPDP coordinator") that is complete once named; every other role has open work.
          if (!row) { must(r.kind === "coord", `${r.label} has an open job of their own`); continue }
          doneIds.add(row.id)
          const done = await markDone(tx, r.email, row.id)
          must(done.ok, `${r.label} marked a job done`)
          const after = (await myPage(tx, r.email, orgId)).rows.find((x: Json) => x.id === row.id)
          must(after?.yes === true, `${r.label}'s "done" persisted on re-read`)
          const persisted = (await tx`select state from dpdp.obligation where id = ${row.id}`)[0]
          must(persisted.state === "closed" || persisted.state === "submitted", `${r.label}'s job is no longer open in the table (state ${persisted.state})`)
        }
        const groupRow = pages[member1].rows.find((r: Json) => r.isGroup)
        must(groupRow, "a group member sees the group job")
        const ans1 = await answerGroup(tx, member1, groupRow.id, "done")
        must(ans1.ok && ans1.answered === 1 && ans1.total === 2 && ans1.closed === false, `member 1 answers: 1 of 2, not closed (${JSON.stringify(ans1)})`)
        must(await refusal(tx, () => answerGroup(tx, staffEmail, groupRow.id, "done")), "someone outside the group cannot answer the group job")
        const ans2 = await answerGroup(tx, member2, groupRow.id, "done")
        must(ans2.ok && ans2.closed === true, "member 2 answers and the group job closes")

        // ---- 5. Monday morning: one digest per membership, in the right shape -------------------
        const monday = await digests(tx, orgId, nowAt(0))
        must(monday.length === 6, `one digest per membership (6 people), got ${monday.length}`)
        const byEmail = Object.fromEntries(monday.map((x) => [x.email, x]))
        for (const [who, kind] of [[ownerEmail, "owner"], [goEmail, "staff"], [coordEmail, "coord"], [staffEmail, "staff"]] as const) {
          must(byEmail[who], `${who} has a digest`)
          must(byEmail[who].roleKind === kind || (kind === "staff" && byEmail[who].roleKind === "staff"), `${who}'s digest roleKind (${byEmail[who].roleKind}) is right`)
          must(byEmail[who].weekKey && !byEmail[who].alreadySentThisWeek, `${who}'s digest is for this week and not yet sent`)
        }
        must(byEmail[ownerEmail].jobs.length > byEmail[staffEmail].jobs.length, "the owner's digest holds more jobs than a staff member's")
        for (const j of byEmail[staffEmail].jobs) must(j.isMine || j.isGroup, "a staff digest holds only their own or group jobs")
        const late = await digests(tx, orgId, nowAt(45))
        const lateOwner = late.find((x) => x.email === ownerEmail)
        must(lateOwner.escalatedToMe.length > 0, "45 days on, the owner's digest names late jobs (escalation)")
        must(late.filter((x) => x.email !== ownerEmail).some((x) => x.jobs.some((j: Json) => j.late && j.isMine)), "45 days on, at least one team member has a late job of their own")
        const orgIds: string[] = (await tx`select public.dpdp_timer_org_ids() as r`)[0].r
        must(orgIds.includes(orgId), "the Monday run includes this organisation")
        // The email link for a job: one tap marks it done, persisted; a reused link is refused.
        const staffMember = staffEmail
        const staffOpen = pages[staffMember].rows.find((r: Json) => !r.isGroup && r.by === staffMember && !r.yes && !doneIds.has(r.id))
        must(staffOpen, "the staff member still has a second open job to close from an email")
        if (staffOpen) {
          const tokens = (await tx`select dpdp.issue_email_action_tokens(${byEmail[staffMember].membershipId}, ${[staffOpen.id]}::text[], '7 days'::interval, null) as r`)[0].r
          must(tokens.length === 1 && tokens[0].done, "a one-tap 'done' link was issued for the job")
          const applied = (await tx`select public.dpdp_apply_email_action(${tokens[0].done}, 'done') as r`)[0].r
          must(applied.ok, `the emailed link marks the job done (${JSON.stringify(applied)})`)
          must((await myPage(tx, staffMember, orgId)).rows.find((x: Json) => x.id === staffOpen.id)?.yes === true, "the email tap persisted")
          must((await tx`select public.dpdp_apply_email_action(${tokens[0].done}, 'done') as r`)[0].r.ok === false, "a used email link is refused the second time")
        }

        // ---- 6. External AI work link, for each role ------------------------------------------
        const l0Owner = await createLink(tx, ownerEmail, orgId, 0)
        const ctxOwner = await linkCtx(tx, l0Owner.token)
        must(ctxOwner.org.id === orgId && ctxOwner.link.authorityLevel === 0, "the owner's Level 0 link reads the owner's organisation")
        const ownerLinkTotal = (await linkJobs(tx, l0Owner.token)).length
        const ownerPageRows = (await myPage(tx, ownerEmail, orgId)).rows.length
        must(ownerLinkTotal === ownerPageRows, `the owner's link shows exactly the owner's page (link ${ownerLinkTotal}, page ${ownerPageRows})`)
        const someJob = (await myPage(tx, ownerEmail, orgId)).rows.find((r: Json) => !r.yes && !r.na)
        must(await refusal(tx, () => linkAction(tx, l0Owner.token, "NOTE", someJob.id, { text: "x" })), "a Level 0 link cannot write")
        must(await refusal(tx, () => linkAction(tx, l0Owner.token, "MARK_DONE", someJob.id, {})), "no link can mark done directly")
        const draft = await linkDraft(tx, l0Owner.token, "MARK_DONE", someJob.id)
        must(draft.draftId && draft.confirmToken, "a Level 2 act becomes a draft the person confirms, nothing changes yet")
        must((await myPage(tx, ownerEmail, orgId)).rows.find((r: Json) => r.id === someJob.id).yes === false, "the draft changed nothing")

        const l1Owner = await createLink(tx, ownerEmail, orgId, 1)
        const note = await linkAction(tx, l1Owner.token, "NOTE", someJob.id, { text: "editions e2e note" })
        must(note.actionId && /via AI assistant/.test(note.recorded), "a Level 1 owner link records a note 'via AI assistant'")
        const due = await linkAction(tx, l1Owner.token, "SET_DUE", someJob.id, { dueOn: "2031-01-31" })
        must(due.actionId, "the owner's Level 1 link can set a due date")
        must((await tx`select to_char(due_on,'YYYY-MM-DD') d from dpdp.obligation where id = ${someJob.id}`)[0].d === "2031-01-31", "the new due date is stored")

        for (const r of [roles[0], roles[1], roles[2], roles[3]]) {
          const l1 = await createLink(tx, r.email, orgId, 1)
          const c = await linkCtx(tx, l1.token)
          must(c.viewer.email === r.email, `${r.label}'s link belongs to ${r.label}`)
          const mine = await linkJobs(tx, l1.token)
          must(mine.length > 0 && mine.length <= pages[r.email].rows.length, `${r.label}'s link shows only their own view (${mine.length} of the page's ${pages[r.email].rows.length})`)
          if (r.kind === "staff") for (const j of mine) must(j.byIsYou || j.isGroup, `${r.label}'s link leaks nobody else's job`)
          const target = mine.find((j: Json) => !j.na && (j.byIsYou || j.isGroup))
          const n = await linkAction(tx, l1.token, "NOTE", target.id, { text: `${r.label} note` })
          must(n.actionId, `${r.label}'s Level 1 link can add a note on their own job`)
          const noDue = await refusal(tx, () => linkAction(tx, l1.token, "SET_DUE", target.id, { dueOn: "2031-02-01" }))
          must(noDue && /owner/i.test(noDue), `${r.label} (not the owner) cannot set a due date, even through a link (got: ${noDue})`)
          if (r.kind === "staff" && !mine.some((j: Json) => j.id === someJob.id)) {
            must(await refusal(tx, () => linkAction(tx, l1.token, "NOTE", someJob.id, { text: "not mine" })), `${r.label}'s link cannot touch a job outside their view`)
          }
        }
        const revoked = await asEmail(tx, ownerEmail, async () => (await tx`select public.dpdp_ai_link_revoke(${l1Owner.linkId}) as r`)[0].r)
        must(revoked.ok, "the owner revoked the Level 1 link")
        must(await refusal(tx, () => linkCtx(tx, l1Owner.token)), "a revoked link is refused on the next call")

        // ---- 7. The CA partner who sets an organisation up for a client; the client's owner ------
        // The CA person needs an active membership somewhere first: here, the firm's own staff seat.
        const unassigned = (await myPage(tx, ownerEmail, orgId)).rows.find((r: Json) => !r.by && !r.na && !r.yes)
        must(unassigned, "the file has a job nobody holds yet")
        const seat = await one(tx, ownerEmail, (t) => t`select public.dpdp_assign_person(${unassigned.id}, ${caEmail}) as r`, "r")
        must(seat.ok, "the owner gave the CA person a seat by assigning them a job")
        const clientName = `E2E client ${ed.product} ${run}`
        const client = await createClientOrg(tx, caEmail, clientName, ed.product, clientOwner)
        must(client.ok && client.jobs === templates && client.ownerMembershipId, "the CA opened a client organisation with its owner named")
        const partnerPage = await myPage(tx, caEmail, client.orgId)
        // The CA-partner jobs (role tag CAPARTNER) exist in the firm library only, so a school's page has no
        // "CA partner" viewer kind -- the school still appears in the CA's "My clients" (0612).
        if (ed.product === "firm") {
          must(partnerPage.viewer.kind === "ca" && partnerPage.viewer.caSub === "partner", `the CA is the client's CA partner (got ${partnerPage.viewer.kind}/${partnerPage.viewer.caSub})`)
        } else {
          must(partnerPage.viewer.kind === "staff" && partnerPage.org.product === "institution", `the CA sees the school as staff (got ${partnerPage.viewer.kind})`)
        }
        const clients: Json[] = await myClients(tx, caEmail)
        must(clients.some((c) => c.org.id === client.orgId && (ed.product !== "firm" || c.caSub === "partner")), "the CA's 'My clients' lists the new client")
        const setup = await orgSetup(tx, clientOwner, client.orgId)
        must(setup.setUpBy?.email === caEmail && !setup.ownerConfirmedAt, "the client's owner is told who set it up and that it awaits their confirmation")
        const clientOwnerPage = await myPage(tx, clientOwner, client.orgId)
        must(clientOwnerPage.viewer.kind === "owner", "the client's owner sees the owner page")
        must((await confirmSetup(tx, clientOwner, client.orgId)).ok, "the client's owner confirmed the setup")
        must((await orgSetup(tx, clientOwner, client.orgId)).ownerConfirmedAt, "the confirmation persisted")

        // ---- 8. The event chain still verifies ---------------------------------------------------
        const events = Number((await tx`select count(*)::int n from dpdp.event where org_id = ${orgId}`)[0].n)
        must(events >= 8, `the organisation's history recorded what happened (${events} events)`)

        throw new Rollback()
      }).catch((e) => {
        if (!(e instanceof Rollback)) throw e
      })

      // Nothing was left behind.
      const leftover = await sql`select count(*)::int n from dpdp.organisation where name like ${`E2E %${run}`}`
      expect(leftover[0].n).toBe(0)
    }, 240_000)
  })
}

describe("editions test file", () => {
  test("covers both editions", () => {
    expect(EDITIONS.map((e) => e.product)).toEqual(["firm", "institution"])
  })
  test("the database was reachable when it was required", () => {
    expect(!requireDb || hasDb).toBe(true)
  })
})
