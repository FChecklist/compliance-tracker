// PROJEXA-BUILD-002 WP-14 (register rows AW-603, AW-701, AW-702, AW-703; objective 8): the PERSONA run. This Claude Code session plays the external AI of
// a project manager, "Sumeet", who manages the ZOOMIES project through the Universal AI Work Link over plain HTTP, against the LOCAL EXECUTION HOST in
// dry mode (scripts/awl-local-exec-host.ts --dry --seed persona: the real link function, the real exec function and the real pipeline over an in-process
// database; nothing leaves the machine; no secret; no live data).
//
//   bun run scripts/verify/persona/persona-run.ts --scenario zoomies|roles|cleanup|way3 [--out <dir>]
//   (the bash wrappers are scripts/verify/persona-zoomies.sh, persona-roles.sh, persona-cleanup-check.sh, way3-zoomies.sh)
//
// WHO DOES WHAT. The AI (class Ai) has ONE thing, the link address, and uses only what the link's manual says: /context, /manual.md, /functions, /records,
// /actions, /propose, /check, /drafts. The PERSON (class Person) is signed in on the app routes: she makes the link (POST /mint), confirms a level-2 draft
// on the confirm-page path (preview, then confirm with the code from the fragment of the confirm address) and revokes links. The VERIFIER re-reads what was
// PERSISTED, from the business tables and the intent rows, never from an answer the AI was given. No step of the AI touches a host route.
//
// WHAT "PASS" MEANS HERE. Each assertion re-reads a row (attribution to the person, executor `ai`, via ai_link, model_calls 0, the value written). It proves
// the code and the path over an in-memory business database; it does NOT prove app_runtime under row-level security or the deployed function (the live run,
// AW-901). The transcript lists every request; tokens and confirm codes are cut to their first six characters.
/// <reference types="bun-types" />
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { Ai, Checks, Person, Transcript, Verifier, key, startHost, linkIdOf, type Host, type Json } from "./persona-lib"

const args = process.argv.slice(2)
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const scenario = opt("--scenario") ?? "zoomies"
const outDir = resolve(process.cwd(), opt("--out") ?? "ai-os/projexa-build-002/persona-runs")
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
const day = (back: number): string => {
  const d = new Date(now.getTime() - back * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const ZOOMIES_TOTAL = 1_596_280
const SUMEET = "person_sumeet"
const money = (n: number) => Math.round(n * 100) / 100
const sumBy = (rows: Json[], f: (r: Json) => number) => money(rows.reduce((s, r) => s + f(r), 0))

type LinkRow = { id: string; owner: "sumeet" | "maya" | "vic"; revoked: boolean; address: string }
type Ctx = { host: Host; v: Verifier; t: Transcript; c: Checks; ids: Json; sumeet: Person; links: LinkRow[]; findings: string[] }

async function personOf(cx: Ctx, who: "sumeet" | "maya" | "vic"): Promise<Person> {
  return who === "sumeet" ? cx.sumeet : new Person(cx.host, cx.t, await cx.v.session(who), who === "maya" ? "Maya" : "Vic")
}

async function mintFor(cx: Ctx, who: "sumeet" | "maya" | "vic", project: string, level: 0 | 1, label: string, functions?: string[]) {
  const p = await personOf(cx, who)
  const m = await p.mint(project, level, label, functions)
  if (m.status === 201 && m.link) cx.links.push({ id: linkIdOf(m.json), owner: who, revoked: false, address: m.link })
  return { ...m, person: p, linkId: linkIdOf(m.json) }
}

async function revokeLink(cx: Ctx, l: LinkRow): Promise<void> {
  if (l.revoked) return
  const r = await (await personOf(cx, l.owner)).revoke(l.id)
  cx.c.ok(r.status === 200 || r.status === 204, `link ${l.id.slice(0, 6)}… is revoked through the app route (${r.status})`)
  l.revoked = true
}

/** The end of every run: revoke each throwaway link through the app route, restore every role, then re-read both. */
async function cleanup(cx: Ctx, baseline: Record<string, string>): Promise<void> {
  cx.t.section("Cleanup: every throwaway link revoked, every demoted user restored")
  for (const l of cx.links) await revokeLink(cx, l)
  for (const [who, role] of Object.entries(baseline)) await cx.v.setRole(who, role)
  const links = await cx.v.links()
  cx.c.eq(links.filter((l) => l.revoked_at === null).length, 0, "no throwaway link is still active (re-read from the links table)")
  cx.c.eq(await cx.v.roles(), baseline, "every user's role is back to what it was at the start (re-read)")
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Scenario 1: Sumeet's week (AW-701)
// ---------------------------------------------------------------------------------------------------------------------------------
async function zoomies(cx: Ctx): Promise<void> {
  const { t, c, v, ids } = cx
  const project = ids.zoomiesProject as string
  const MON = day(4), TUE = day(3), WED = day(2), THU = day(1), FRI = day(0)
  const persisted: Array<{ fn: string; link: string; submission: string | null }> = []

  // Sumeet's AI gets a new link each morning and the old one is revoked in the evening: a link makes at most 30 changes and drafts an hour.
  let ai!: Ai
  let linkId = ""
  let link = ""
  const morning = async (label: string): Promise<void> => {
    const m = await mintFor(cx, "sumeet", project, 1, label)
    c.eq(m.status, 201, `${label}: the mint route answers 201 for a project the person can read`)
    link = m.link as string
    linkId = m.linkId
    ai = new Ai(link, t, "AI")
  }
  const evening = async (): Promise<void> => {
    const l = cx.links.find((x) => x.id === linkId)!
    await revokeLink(cx, l)
    const after = await new Ai(l.address, t, "AI (yesterday's link)").get("/context?format=json")
    c.eq(after.status, 410, "the evening's link is gone: the same address answers 410")
  }
  let fns = new Map<string, Json>()
  const direct = async (fn: string, params: Json, k: string): Promise<{ status: number; id: string | null; json: Json }> => {
    c.eq(fns.get(fn)?.level, 1, `${fn} is listed by the link as a level-1 (direct) function`)
    const r = await ai.action(fn, params, key(k))
    if (r.status === 201) persisted.push({ fn, link: linkId, submission: r.json.submission_id ?? null })
    return { status: r.status, id: (r.json.record?.id as string | undefined) ?? null, json: r.json }
  }
  const drafted = async (fn: string, params: Json, k: string) => {
    c.eq(fns.get(fn)?.level, 2, `${fn} is listed by the link as a level-2 (the person confirms) function`)
    const d = await ai.draft(fn, params, key(k))
    c.eq(d.status, 201, `${fn}: the draft is recorded (201) and nothing has changed yet`)
    const done = await cx.sumeet.confirmFromUrl(String(d.json.confirm_url))
    if (done.status === 200 && done.json.status === "done") persisted.push({ fn, link: linkId, submission: done.json.submission_id ?? null })
    c.ok(done.status === 200 && done.json.status === "done", `${fn}: the person confirms and it is applied${done.json.status !== "done" ? ` (got ${done.status} ${done.json.status ?? ""} ${done.json.code ?? ""})` : ""}`)
    return { draft: d, confirm: done, id: (done.json.record?.id as string | undefined) ?? null }
  }
  const rowsOf = async (table: string, f: (r: Json) => boolean = () => true) => (await v.table(table)).filter((r) => r.projectId === project && f(r))
  const byId = async (table: string, id: string | null) => (await v.table(table)).find((r) => r.id === id)

  // ================================================== MONDAY =================================================================
  t.section("Monday. Sumeet makes a link for his AI, and the AI reads before it touches anything")
  await morning("Monday, Sumeet's chat AI")
  const ctxDoc = (await ai.get("/context?format=json")).json
  c.eq([ctxDoc.level, ctxDoc.effective_level, ctxDoc.writes_enabled], [1, 1, true], "context: level 1, effective level 1, writes on")
  c.ok(String(ctxDoc.project?.name ?? "").includes("ZOOMIES"), "context names the ZOOMIES project (the link is for that one project)")
  c.eq(Object.keys(ctxDoc.money_fields ?? {}).length, 0, "context: no money field is hidden from the manager's link")
  const manual = await ai.getText("/manual.md")
  c.ok(manual.status === 200 && manual.text.length > 2000, "the manual is readable and long enough to teach the call shapes")
  c.ok(/\/actions/.test(manual.text) && /\/drafts/.test(manual.text) && /confirm/i.test(manual.text), "the manual names /actions, /drafts and the person's confirmation")
  const fnPage = (await ai.get("/functions?format=json&per_page=100")).json
  c.ok(fnPage.total >= 90, `the function list is discoverable (${fnPage.total} functions)`)
  fns = new Map<string, Json>((fnPage.functions as Json[]).map((f) => [f.id as string, f]))
  const level1 = [...fns.values()].filter((f) => f.kind === "write" && f.level === 1).length
  const level2 = [...fns.values()].filter((f) => f.kind === "write" && f.level === 2).length
  c.ok(level1 > 20 && level2 > 15, `both levels are on the list (${level1} direct, ${level2} need the person)`)

  const boqs = await ai.records("boqs")
  c.eq(boqs.length, 1, "records/boqs: the project has one BOQ")
  const lines = await ai.records("boq_lines", 50)
  c.eq(lines.length, 53, "records/boq_lines: all 53 lines are readable across pages")
  c.eq(sumBy(lines, (l) => Number(l.amount)), ZOOMIES_TOTAL, "the manager sees the money: the lines add up to AED 1,596,280")
  const persistedLines = (await v.table("construction_boq_line_items")).filter((l) => l.boqId === boqs[0].id)
  c.eq(sumBy(persistedLines, (l) => Number(l.quantity) * Number(l.rate)), ZOOMIES_TOTAL, "re-read from the database: quantity times rate of the stored lines is AED 1,596,280")

  t.section("Monday. The crew: roster (a draft the person confirms) and attendance")
  const rosterBefore = (await rowsOf("construction_labour_roster")).length
  const d1 = await ai.draft("add_roster_entry", { name: "Ravi Kumar", dailyRate: 850, trade: "Carpenter" }, key("roster-1"))
  c.eq(d1.status, 201, "add_roster_entry (a money field) is a draft at level 2")
  c.eq((await rowsOf("construction_labour_roster")).length, rosterBefore, "re-read: the draft wrote no roster row")
  const c1 = await cx.sumeet.confirmFromUrl(String(d1.json.confirm_url))
  c.ok(c1.status === 200 && c1.json.status === "done", "the signed-in person confirms and the change is applied")
  persisted.push({ fn: "add_roster_entry", link: linkId, submission: c1.json.submission_id ?? null })
  const replayDraft = await ai.draft("add_roster_entry", { name: "Ravi Kumar", dailyRate: 850, trade: "Carpenter" }, key("roster-1"))
  c.ok(replayDraft.status === 200 && replayDraft.json.replayed === true && !replayDraft.json.confirm_url, "the same draft again is a replay and does not hand out a second confirm address")
  const c1b = await cx.sumeet.confirmFromUrl(String(d1.json.confirm_url), { preview: false })
  c.ok(c1b.status === 409 || (c1b.status === 200 && c1b.json.status === "done"), `the same confirm address a second time does not apply it again (${c1b.status})`)
  c.eq((await rowsOf("construction_labour_roster")).length - rosterBefore, 1, "re-read: still one roster row after the second confirm")
  await drafted("add_roster_entry", { name: "Anita Shah", dailyRate: 900, trade: "Painter" }, "roster-2")
  const roster = await ai.records("roster")
  c.eq(roster.length, 2, "records/roster: the AI reads back the two people the person confirmed")
  c.eq((await rowsOf("construction_labour_roster")).length - rosterBefore, 2, "re-read: two roster rows exist for this project")

  const att = await direct("record_attendance_batch", { date: MON, entries: roster.map((r) => ({ rosterId: r.id, status: "present" })) }, "attendance-1")
  c.eq(att.status, 201, "record_attendance_batch is applied directly (level 1)")
  c.eq((await rowsOf("construction_attendance")).length, 2, "re-read: two attendance rows exist, one per person")
  const again = await ai.action("record_attendance_batch", { date: MON, entries: roster.map((r) => ({ rosterId: r.id, status: "present" })) }, key("attendance-1"))
  c.ok(again.status === 200 && again.json.replayed === true, "the same request again is a replay (200, replayed)")
  c.eq((await rowsOf("construction_attendance")).length, 2, "re-read: the replay added no attendance row")
  await direct("record_attendance", { rosterId: roster[0].id, date: TUE, status: "present" }, "attendance-2")

  t.section("Monday. Site progress against the BOQ")
  c.eq((await direct("create_progress_category", { name: "Play Area finishes" }, "category")).status, 201, "create_progress_category")
  c.eq((await direct("create_activity", { name: "Rubber flooring", unit: "sqm" }, "activity")).status, 201, "create_activity")
  const itemCode = String(lines[0].item_code)
  const prog = await direct("record_work_progress", { itemCode, percent: 25, entryDate: MON, remarks: "Base coat done, level 1" }, "progress-1")
  c.eq(prog.status, 201, `record_work_progress on BOQ line ${itemCode}`)
  const entry = await byId("construction_work_progress_entries", prog.id)
  c.ok(Number(entry?.percentComplete) === 25 && entry?.entryDate === MON && String(entry?.remarks ?? "").includes("Base coat"), "re-read: the entry holds 25 percent, the date and the remarks the AI sent")
  c.eq(entry?.recordedById, SUMEET, "re-read: the progress entry is attributed to Sumeet, not to the AI")
  const later = await direct("record_work_progress", { itemCode, percent: 60, entryDate: WED, remarks: "Second coat and edge trim" }, "progress-2")
  c.eq(later.status, 201, "a second entry for the same line, later in the week")
  c.ok((await ai.records("progress")).length >= 2, "records/progress: the AI reads its two entries back")
  await evening()

  // ================================================== TUESDAY ================================================================
  t.section("Tuesday. RFIs, submittals and the punch list")
  await morning("Tuesday, Sumeet's chat AI")
  const rfi = await direct("create_rfi", { subject: "Rubber tile thickness, play area", question: "Confirm 20 mm or 25 mm tiles at the climbing zone.", dueDate: THU }, "rfi-1")
  c.eq(rfi.status, 201, "create_rfi")
  const rfiRow = await byId("construction_rfis", rfi.id)
  c.ok(rfiRow?.status === "open" && rfiRow?.raisedById === SUMEET && rfiRow?.projectId === project, "re-read: the RFI is open, on this project, raised by Sumeet")
  const ans = await drafted("answer_rfi", { rfiId: rfi.id, answer: "Use 25 mm as drawing A-14 rev C." }, "rfi-answer")
  c.ok(ans.confirm.json.status === "done", "answer_rfi is a draft: the person confirms and it is applied")
  c.eq((await direct("close_rfi", { rfiId: rfi.id }, "rfi-close")).status, 201, "close_rfi (level 1) after the answer")
  c.eq((await byId("construction_rfis", rfi.id))?.status, "closed", "re-read: the RFI is closed")

  const sub = await direct("create_submittal", { title: "Rubber tile sample, play zone", specSection: "09 65 00", dueDate: FRI }, "submittal-1")
  c.eq(sub.status, 201, "create_submittal")
  const mayas = (await ai.records("submittals")).find((r) => String(r.title).startsWith("Partition board"))
  c.ok(!!mayas, "records/submittals: the AI finds the sample Maya raised earlier")
  await drafted("review_submittal", { submittalId: mayas?.id, status: "approved", comments: "Approved for the vet area only." }, "submittal-review")
  const reviewed = await byId("construction_submittals", "submittal_maya")
  c.ok(reviewed?.status === "approved" && reviewed?.reviewedById === SUMEET, "re-read: Maya's submittal is approved and the reviewer is Sumeet")
  const own = await ai.draft("review_submittal", { submittalId: sub.id, status: "approved" }, key("submittal-self"))
  const ownConfirm = await cx.sumeet.confirmFromUrl(String(own.json.confirm_url))
  c.ok(ownConfirm.json.status === "failed" || ownConfirm.json.status === "refused", `a submittal cannot be reviewed by the person who raised it: it is not applied (${ownConfirm.json.status} ${ownConfirm.json.code ?? ""})`)
  c.eq((await byId("construction_submittals", sub.id))?.status, "pending", "re-read: the submittal Sumeet's AI raised is still pending")

  const punch = await direct("create_punch_list_item", { description: "Chipped skirting, vet reception", location: "Vet Area", trade: "Joinery" }, "punch-1")
  c.eq(punch.status, 201, "create_punch_list_item")
  c.eq((await direct("mark_punch_item_ready", { itemId: punch.id }, "punch-ready")).status, 201, "mark_punch_item_ready")
  c.eq((await byId("construction_punch_list_items", punch.id))?.status, "ready_for_review", "re-read: the punch item is ready for review")
  await drafted("verify_punch_item_closed", { itemId: punch.id }, "punch-verify")
  c.eq((await byId("construction_punch_list_items", punch.id))?.status, "verified_closed", "re-read: the punch item is verified closed")
  await evening()

  // ================================================== WEDNESDAY ==============================================================
  t.section("Wednesday. Site diary, schedule, milestones, meetings and minutes")
  await morning("Wednesday, Sumeet's chat AI")
  const diary = await direct("create_site_diary", { diaryDate: WED, weather: "Hot, 39 C", workDone: "Flooring base coat, partition boards", labourCount: 14 }, "diary-1")
  c.eq(diary.status, 201, "create_site_diary")
  c.ok((await byId("construction_site_diaries", diary.id))?.recordedById === SUMEET, "re-read: the diary is recorded by Sumeet")
  const task = await direct("create_schedule_task", { title: "Install climbing frame", startDate: FRI, durationDays: 5 }, "task-1")
  c.eq(task.status, 201, "create_schedule_task")
  const ms = await direct("create_milestone", { title: "Play Area handover", targetDate: "2026-11-15" }, "milestone-1")
  c.eq(ms.status, 201, "create_milestone")
  c.eq((await direct("update_milestone", { milestoneId: ms.id, status: "in_progress" }, "milestone-2")).status, 201, "update_milestone")
  const mtg = await direct("create_meeting", { title: "Weekly site review", scheduledAt: `${WED}T10:00:00Z` }, "meeting-1")
  c.eq(mtg.status, 201, "create_meeting")
  c.eq((await direct("add_meeting_outcome", { meetingId: mtg.id, notes: "Client accepted the mock-up of the entrance." }, "meeting-outcome")).status, 201, "add_meeting_outcome")
  const mom = await direct("create_mom", { title: "Weekly site review minutes", scheduledAt: `${WED}T10:00:00Z`, attendees: ["Sumeet", "Ravi"], minutes: "Slab pour agreed." }, "mom-1")
  c.eq(mom.status, 201, "create_mom")
  c.eq((await direct("add_meeting_action_item", { meetingId: mom.id, title: "Confirm tile order with the supplier", dueDate: FRI }, "meeting-action")).status, 201, "add_meeting_action_item on the minutes")
  c.eq((await direct("update_mom_minutes", { meetingId: mom.id, minutes: "Slab pour agreed for Monday; tiles ordered." }, "mom-2")).status, 201, "update_mom_minutes")
  await drafted("publish_mom", { meetingId: mom.id }, "mom-publish")
  await evening()

  // ================================================== THURSDAY ===============================================================
  t.section("Thursday. Timesheets, materials, site instructions, change orders, billing and KPI")
  await morning("Thursday, Sumeet's chat AI")
  c.eq((await direct("record_timesheet", { task: "Install climbing frame", hours: 3.5 }, "timesheet-1")).status, 201, "record_timesheet against the schedule task the AI made on Wednesday")
  const sheets = await ai.records("timesheets")
  c.ok(sheets.length >= 2, "records/timesheets: the AI reads its own entry and Maya's submitted week")
  c.ok(sheets.some((r) => r.id === "time_maya"), "the AI finds Maya's submitted timesheet")
  await drafted("approve_timesheet", { timeEntryId: "time_maya" }, "timesheet-approve")
  c.eq((await byId("pms_time_entries", "time_maya"))?.approvalStatus, "approved", "re-read: Maya's timesheet is approved")
  const mine = (await v.table("pms_time_entries")).find((r) => r.userId === SUMEET)
  c.eq(mine?.approvalStatus, "draft", "re-read: the entry the AI recorded for Sumeet stays a draft (no link function submits a timesheet)")
  cx.findings.push("A timesheet entry recorded through the link stays `draft`: no link function submits it, so approve_timesheet can only act on a week a person submitted in the app.")

  const mat = await drafted("create_material", { name: "Rubber tile 25 mm", unit: "sqm", unitCost: 210 }, "material-1")
  const rcp = await drafted("record_material_receipt", { materialId: mat.id, quantity: 120, unitCost: 205, receivedDate: THU }, "receipt-1")
  c.ok(!!rcp.id, "record_material_receipt (money) is applied after the confirm")
  const issue = await direct("record_material_issue", { materialId: mat.id, quantity: 40, issuedDate: FRI, issuedTo: "Flooring gang" }, "issue-1")
  c.eq(issue.status, 201, "record_material_issue (level 1) against the received stock")
  const over = await ai.action("record_material_issue", { materialId: mat.id, quantity: 500, issuedDate: FRI, issuedTo: "Flooring gang" }, key("issue-over"))
  c.ok(over.status >= 400, `issuing more than is in stock is refused (${over.status} ${over.json.code ?? ""})`)
  await drafted("create_site_instruction", { issueDate: THU, toContractor: "Main contractor", description: "Move the reception door 300 mm to the left" }, "si-1")
  const co = await drafted("create_change_order", { title: "Extra partition, vet area", reason: "Client request", scheduleImpactDays: 3 }, "co-1")
  c.ok(!!(await byId("construction_change_orders", co.id)), "re-read: the change order exists")

  const claim = await drafted("create_progress_claim", { boqId: boqs[0].id, customerId: "customer_zoomies", milestoneDescription: "Play Area partitions complete", scheduledDate: FRI, retentionPercent: 5 }, "claim-1")
  c.eq((await byId("construction_progress_claims", claim.id))?.createdById, SUMEET, "re-read: the billing claim was created for Sumeet")
  await drafted("draft_progress_claim", { claimId: claim.id }, "claim-2")
  await drafted("submit_progress_claim", { claimId: claim.id }, "claim-3")
  c.eq((await byId("construction_progress_claims", claim.id))?.status, "submitted", "re-read: the billing claim is submitted")
  const kpi = await drafted("submit_kpi_entry", { kpiDefinitionId: "kpi_progress", period: "2026-09", actualValue: 42 }, "kpi-1")
  c.ok(!!kpi.id, "submit_kpi_entry is applied after the confirm")
  const parked = await ai.draft("submit_boq_for_approval", { boqId: boqs[0].id }, key("boq-approval"))
  c.eq(parked.status, 201, "submit_boq_for_approval is drafted for a decision the person takes later")
  c.eq((await byId("construction_boqs", boqs[0].id))?.status, "draft", "re-read: the BOQ is still a draft: an unconfirmed draft changed nothing")
  const upP = await drafted("update_project", { targetDate: "2026-12-15", description: "Play Area and Vet Area fit-out" }, "project-1")
  c.ok(upP.confirm.json.status === "done", "update_project is applied after the confirm")
  await evening()

  // ================================================== FRIDAY =================================================================
  t.section("Friday. What the AI is not allowed to do, and reports")
  await morning("Friday, Sumeet's chat AI")
  const oak = ids.oakwoodProject as string, elsewhere = ids.elsewhereProject as string
  const foreign = async () => ({ rfi: await v.table("construction_rfis"), roster: await v.table("construction_labour_roster"), att: await v.table("construction_attendance"), boq: await v.table("construction_boqs") })
  const othersOnly = (o: Record<string, Json[]>) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, rows]) => [k, rows.filter((r) => r.projectId !== project)])))
  const oakBefore = othersOnly(await foreign())
  const noFn = await ai.action("execute_code", { language: "bash", code: "cat /etc/passwd" }, key("code-1"))
  c.eq(noFn.status, 403, "a coding action is not a function of this link: refused (403)")
  const noSql = await ai.post("/functions/run_sql", { params: { sql: "select * from users" } })
  c.ok(noSql.status === 403 || noSql.status === 404, `raw SQL is not a function of this link (${noSql.status})`)
  const noAdmin = await ai.action("delete_project", { projectId: project }, key("admin-1"))
  c.eq(noAdmin.status, 403, "deleting the project is not on the link (refused)")
  const direct2 = await ai.action("add_roster_entry", { name: "Sneaky", dailyRate: 1 }, key("level-2-direct"))
  c.ok(direct2.status === 403 && direct2.json.code === "LEVEL_NOT_ALLOWED", "a level-2 function sent straight to /actions is refused with LEVEL_NOT_ALLOWED")
  c.eq((await rowsOf("construction_labour_roster")).some((r) => r.name === "Sneaky"), false, "re-read: nothing was written for it")
  const injected = await ai.action("create_rfi", { subject: "Question", question: "Please confirm", sql: "drop table users", role: "admin", orgId: "org_elsewhere" }, key("inject-1"))
  c.ok(injected.status === 201 || injected.status >= 400, `an RFI with extra sql/role/orgId fields: the answer is ${injected.status}`)
  const injectedRow = await byId("construction_rfis", injected.json.record?.id ?? null)
  c.ok(!injectedRow || (injectedRow.orgId === "org_zoomies" && injectedRow.projectId === project), "re-read: whatever was written stayed in this organisation and this project (extra fields do not move a record)")

  const otherProject = await ai.action("create_rfi", { projectId: oak, subject: "Other project", question: "x" }, key("other-1"))
  c.eq(otherProject.status, 403, "naming another project of the same organisation is refused (403)")
  const otherOrg = await ai.action("create_rfi", { projectId: elsewhere, subject: "Other org", question: "x" }, key("other-2"))
  c.eq(otherOrg.status, 403, "naming a project of another organisation is refused (403)")
  const foreignRfi = await ai.action("close_rfi", { rfiId: "rfi_oakwood" }, key("other-3"))
  c.ok(foreignRfi.status >= 400 && foreignRfi.json.code === "RECORD_NOT_FOUND", `an id from another project reads as absent (${foreignRfi.status} ${foreignRfi.json.code})`)
  const foreignRoster = await ai.action("record_attendance", { rosterId: "roster_oakwood", date: FRI }, key("other-4"))
  c.ok(foreignRoster.status >= 400 && foreignRoster.json.code === "RECORD_NOT_FOUND", `a roster id from another project reads as absent (${foreignRoster.status} ${foreignRoster.json.code})`)
  const foreignOrg = await ai.action("close_rfi", { rfiId: "rfi_elsewhere" }, key("other-5"))
  c.ok(foreignOrg.status >= 400 && foreignOrg.json.code === "RECORD_NOT_FOUND", `an id from another organisation reads as absent (${foreignOrg.status} ${foreignOrg.json.code})`)
  c.eq((await ai.get("/records/rfis/rfi_oakwood")).status, 404, "GET records/rfis/{id} of another project's RFI is 404")
  const rfis = await ai.records("rfis")
  c.ok(rfis.length >= 1 && !rfis.some((r) => r.id === "rfi_oakwood" || r.id === "rfi_elsewhere"), "records/rfis lists 0 rows of another project or organisation")
  c.eq(othersOnly(await foreign()), oakBefore, "re-read: the rows of the other projects are byte-identical before and after the attempts")

  const bad = await new Ai(link.replace(/pxa_[0-9a-f]{64}/, "pxa_" + "0".repeat(64)), t, "AI (a made-up token)").get("/context?format=json")
  c.ok(bad.status === 404 || bad.status === 410, `a made-up token answers ${bad.status} and no data`)
  const qs = await new Ai(link, t, "AI (token in the query string)").get(`/context?token=${link.split("/").pop()}`)
  c.eq(qs.status, 400, "a token sent as a query parameter is refused (400)")

  t.section("Friday. Reports and exceptions")
  const exc = await ai.post("/functions/get_project_exceptions", { params: {} })
  const rep = await ai.post("/functions/run_named_report", { params: { reportSlug: "work-progress" } })
  c.ok([200, 501, 503].includes(exc.status) && [200, 501, 503].includes(rep.status), `function reads are asked for: exceptions ${exc.status}, report ${rep.status}`)
  if (exc.status !== 200) cx.findings.push(`POST /functions/{fn} for a READ function (get_project_exceptions, run_named_report) answers ${exc.status} even with writes on and the exec function wired ("Written in a later unit"): reports and exceptions are not readable through the link yet. The AI worked from records/ instead.`)
  const progress = await ai.records("progress")
  const claims = await ai.records("progress_claims")
  const kpis = await ai.records("kpi_entries")
  c.ok(progress.length >= 2 && claims.length === 1 && kpis.length === 1, "the AI reads the week back: progress entries, the billing claim and the KPI entry")
  c.eq(claims[0]?.status, "submitted", "records/progress_claims: the claim is submitted (the same as the stored row)")
  await evening()

  await provenance(cx, persisted)
}

/** The closing assertions of the week: attribution and provenance of every write, re-read. */
async function provenance(cx: Ctx, persisted: Array<{ fn: string; link: string; submission: string | null }>): Promise<void> {
  const { c, v, t } = cx
  t.section("Provenance of every write (re-read from the database)")
  const st = await v.state()
  const subs = st.tables.submissions ?? []
  const tasks = st.tables.pipeline_tasks ?? []
  const aiSubs = subs.filter((s) => s.via === "ai_link")
  const linkIds = new Set(cx.links.filter((l) => l.owner === "sumeet").map((l) => l.id))
  c.ok(aiSubs.length >= persisted.length, `every applied change left a submission via ai_link (${aiSubs.length} submissions for ${persisted.length} applied changes)`)
  c.eq(subs.filter((s) => s.via !== "ai_link").length, 0, "no write reached the database except through a link: every submission is via ai_link")
  c.ok(aiSubs.every((s) => s.userId === SUMEET), "each submission names Sumeet as the user")
  c.ok(aiSubs.every((s) => linkIds.has(String(s.aiLinkId))), "each submission names one of Sumeet's five links")
  c.ok(persisted.every((p) => aiSubs.some((s) => s.id === p.submission && s.aiLinkId === p.link)), "each applied change points at a submission of the link that made it")
  c.ok(aiSubs.every((s) => Number(s.modelCalls) === 0), "each submission has model_calls 0")
  c.ok(aiSubs.every((s) => s.level1Outcome === "not_needed"), "each submission has level1_outcome not_needed")
  const mine = tasks.filter((k) => aiSubs.some((s) => s.id === k.submissionId))
  c.ok(mine.length >= persisted.length && mine.every((k) => k.executor === "ai"), "each task is executor ai, never software")
  c.ok(mine.filter((k) => k.status === "done").length >= persisted.length, `the done tasks number at least the applied changes (${mine.filter((k) => k.status === "done").length})`)
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Scenario 2: role limits (AW-702)
// ---------------------------------------------------------------------------------------------------------------------------------
async function roles(cx: Ctx): Promise<void> {
  const { t, c, v, ids } = cx
  const project = ids.zoomiesProject as string
  const oak = ids.oakwoodProject as string
  const elsewhere = ids.elsewhereProject as string

  t.section("Set-up. Sumeet's AI records a crew member and a material (money rows), so the money columns hold data to hide")
  const s = await mintFor(cx, "sumeet", project, 1, "Set-up, Sumeet's chat AI")
  const aiS = new Ai(s.link as string, t, "Sumeet's AI")
  for (const [fn, params, k] of [
    ["add_roster_entry", { name: "Ravi Kumar", dailyRate: 850, trade: "Carpenter" }, "roles-roster"],
    ["create_material", { name: "Rubber tile 25 mm", unit: "sqm", unitCost: 210 }, "roles-material"],
  ] as const) {
    const d = await aiS.draft(fn, params as Json, key(k))
    const done = await cx.sumeet.confirmFromUrl(String(d.json.confirm_url))
    c.ok(done.json.status === "done", `set-up: ${fn} is drafted by the AI and confirmed by Sumeet`)
  }
  const managerLines = await aiS.records("boq_lines", 50)
  const managerRoster = await aiS.records("roster")
  c.ok(managerLines.length === 53 && managerLines.every((l) => l.rate !== null && l.rate !== undefined), "the manager's link sees every line with its rate")
  c.ok(Number(managerRoster[0]?.daily_rate) === 850, "the manager's link sees the daily rate of the crew member")

  t.section("Maya, a member (rank 2): what her link can and cannot do")
  const m = await mintFor(cx, "maya", project, 1, "Maya's chat AI")
  c.eq(m.status, 201, "a member can make a level-1 link for a project she can read")
  const aiM = new Ai(m.link as string, t, "Maya's AI")
  const ctxM = (await aiM.get("/context?format=json")).json
  const hiddenM = (ctxM.money_fields ?? {}) as Record<string, string[]>
  c.ok(Object.keys(hiddenM).length > 0 && (hiddenM.boq_lines ?? []).includes("rate"), "context: the money fields hidden from this link are listed (boq_lines rate among them)")
  const fnM = ((await aiM.get("/functions?format=json&per_page=100")).json.functions ?? []) as Json[]
  c.ok(fnM.length > 20 && fnM.every((f) => f.min_role_rank <= 2), `every function on Maya's link needs rank 2 or lower (${fnM.length} functions)`)
  for (const fn of ["approve_timesheet", "seal_boq", "publish_mom", "review_submittal", "verify_punch_item_closed", "approve_kpi_entry", "submit_progress_claim", "create_progress_claim"]) {
    c.ok(!fnM.some((f) => f.id === fn), `${fn} (rank 3) is not on Maya's link`)
  }
  const refusedAction = await aiM.action("approve_timesheet", { timeEntryId: "time_maya" }, key("maya-approve"))
  c.eq(refusedAction.status, 403, "a rank-3 function sent to /actions on Maya's link is refused (403)")
  const refusedDraft = await aiM.draft("seal_boq", { boqId: "x", controlTotals: { grand: 1 }, expectedLineCount: 1 }, key("maya-seal"))
  c.eq(refusedDraft.status, 403, "a rank-3 function sent to /drafts on Maya's link is refused (403)")

  const hide = async (kind: string, cols: string[]): Promise<{ rows: number; nonNull: number }> => {
    const rows = await aiM.records(kind, 50)
    let nonNull = 0
    for (const r of rows) for (const col of cols) if (r[col] !== undefined && r[col] !== null) nonNull++
    return { rows: rows.length, nonNull }
  }
  const lines = await hide("boq_lines", hiddenM.boq_lines ?? [])
  c.ok(lines.rows === 53 && lines.nonNull === 0, `records/boq_lines: 53 rows, 0 money values (${lines.nonNull} non-null in ${(hiddenM.boq_lines ?? []).length} hidden columns)`)
  const roster = await hide("roster", hiddenM.roster ?? [])
  c.ok(roster.rows === 1 && roster.nonNull === 0 && (hiddenM.roster ?? []).length > 0, "records/roster: the crew member is visible, the daily rate is not")
  const mats = await hide("materials", hiddenM.materials ?? [])
  c.ok(mats.rows >= 1 && mats.nonNull === 0 && (hiddenM.materials ?? []).length > 0, "records/materials: the material is visible, its cost is not")
  const boqsM = await aiM.records("boqs")
  c.ok(boqsM.length === 1 && (boqsM[0].contract_value_override === undefined || boqsM[0].contract_value_override === null), "records/boqs: no contract value")
  const csv = await aiM.get("/records/boq_lines?format=csv&limit=5")
  c.ok(csv.status === 200 && !/\b(19000|28500)\b/.test(csv.text), "the CSV form of the same page carries no money either")
  const okWrite = await aiM.action("record_work_progress", { itemCode: String(managerLines[0].item_code), percent: 10, entryDate: day(0), remarks: "Maya, walk-round" }, key("maya-progress"))
  c.eq(okWrite.status, 201, "what a member may do works: a level-1 progress entry")
  const mayaEntry = (await v.table("construction_work_progress_entries")).find((r) => r.id === okWrite.json.record?.id)
  c.eq(mayaEntry?.recordedById, "person_maya", "re-read: the entry is attributed to Maya, not to Sumeet")

  const moneyFns = fnM.filter((f) => f.money_sensitive === true && f.kind === "write")
  const moneyDraft = await aiM.draft("add_roster_entry", { name: "Maya's man", dailyRate: 700 }, key("maya-money"))
  cx.findings.push(`Maya's member link carries ${moneyFns.length} money-sensitive WRITE functions as level-2 drafts (rank 2 is enough: ${moneyFns.map((f) => f.id).slice(0, 6).join(", ")} ...); her draft of add_roster_entry was ${moneyDraft.status}. The register row AW-702 reads "cannot write money functions"; what the code guarantees is "sees no money, and every money change waits for the person's confirmation".`)
  c.ok(moneyDraft.status === 201 && !!moneyDraft.json.confirm_url, "a money change on Maya's link is a DRAFT: nothing is written until the person confirms")
  c.eq((await v.table("construction_labour_roster")).some((r) => r.name === "Maya's man"), false, "re-read: the money draft wrote no row")
  const direct = await aiM.action("add_roster_entry", { name: "Maya's man 2", dailyRate: 700 }, key("maya-money-direct"))
  c.ok(direct.status === 403 && direct.json.code === "LEVEL_NOT_ALLOWED", "sent straight to /actions the same money change is refused (LEVEL_NOT_ALLOWED)")

  t.section("Vic, a viewer (rank 1), and people who may not use this project at all")
  const vicL1 = await mintFor(cx, "vic", project, 1, "Vic level 1")
  c.eq(vicL1.status, 403, "a viewer may not choose level 1 for a link (403)")
  const vic0 = await mintFor(cx, "vic", project, 0, "Vic read only")
  c.eq(vic0.status, 201, "a viewer may make a level-0 (read and draft) link")
  const aiV = new Ai(vic0.link as string, t, "Vic's AI")
  const fnV = ((await aiV.get("/functions?format=json&per_page=100")).json.functions ?? []) as Json[]
  c.ok(fnV.every((f) => f.min_role_rank <= 1), `Vic's link lists only rank 1 functions (${fnV.length})`)
  c.eq((await aiV.action("create_rfi", { subject: "x", question: "y" }, key("vic-rfi"))).status, 403, "Vic's level-0 link cannot make a direct change")
  const olga = await new Person(cx.host, t, await v.session("other"), "Olga (another organisation)").mint(project, 1, "not hers")
  c.ok(olga.status === 404 || olga.status === 403, `a person of another organisation cannot make a link for this project (${olga.status})`)
  const mayaOther = await new Person(cx.host, t, await v.session("maya"), "Maya").mint(elsewhere, 0, "not hers")
  c.ok(mayaOther.status === 404 || mayaOther.status === 403, `Maya cannot make a link for a project of another organisation (${mayaOther.status})`)

  t.section("A link for another project of the same organisation")
  const oakLink = await mintFor(cx, "sumeet", oak, 1, "Oakwood, Sumeet's chat AI")
  c.eq(oakLink.status, 201, "Sumeet can make a link for the Oakwood project too")
  const aiO = new Ai(oakLink.link as string, t, "AI (Oakwood link)")
  const zoomiesRfiBefore = (await v.table("construction_rfis")).filter((r) => r.projectId === project).length
  const wrongProject = await aiO.action("create_rfi", { projectId: project, subject: "Wrong project", question: "x" }, key("oak-wrong"))
  c.eq(wrongProject.status, 403, "the Oakwood link naming the ZOOMIES project is refused (403)")
  const zoomiesRoster = (await aiS.records("roster"))[0]
  const wrongRoster = await aiO.action("record_attendance", { rosterId: zoomiesRoster.id, date: day(0) }, key("oak-roster"))
  c.ok(wrongRoster.status >= 400 && wrongRoster.json.code === "RECORD_NOT_FOUND", `the Oakwood link using a ZOOMIES roster id reads it as absent (${wrongRoster.status} ${wrongRoster.json.code})`)
  const oakLines = await aiO.records("boq_lines")
  c.ok(oakLines.every((l) => l.boq_id !== ids.zoomiesBoq), "the Oakwood link's records hold no ZOOMIES BOQ line")
  c.eq((await v.table("construction_rfis")).filter((r) => r.projectId === project).length, zoomiesRfiBefore, "re-read: nothing was written on the ZOOMIES project by the Oakwood link")
  c.eq((await v.table("construction_attendance")).length, 0, "re-read: no attendance row exists")

  t.section("A demotion changes what an existing link may do, at once")
  const wk = await mintFor(cx, "sumeet", project, 1, "Before the demotion")
  const aiW = new Ai(wk.link as string, t, "AI (Sumeet's link)")
  const before = ((await aiW.get("/functions?format=json&per_page=100")).json.functions ?? []) as Json[]
  c.ok(before.some((f) => f.id === "approve_timesheet"), "before: the manager's link carries approve_timesheet")
  const pending = await aiW.draft("approve_timesheet", { timeEntryId: "time_maya" }, key("pre-demotion-draft"))
  c.eq(pending.status, 201, "the AI drafts approve_timesheet while Sumeet is a manager")
  await v.setRole("sumeet", "member")
  const after = ((await aiW.get("/functions?format=json&per_page=100")).json.functions ?? []) as Json[]
  c.ok(!after.some((f) => f.id === "approve_timesheet"), "after the demotion the same link no longer carries approve_timesheet")
  const moneyAfter = await aiW.records("boq_lines", 50)
  c.ok(moneyAfter.length === 53 && moneyAfter.every((l) => l.rate === null || l.rate === undefined), "after the demotion the same link reads no rates (money is redacted by the role NOW)")
  const late = await cx.sumeet.confirmFromUrl(String(pending.json.confirm_url))
  c.ok(late.json.status === "refused" || late.json.status === "failed" || late.status >= 400, `confirming the earlier draft after the demotion does not apply it (${late.status} ${late.json.status ?? ""} ${late.json.code ?? ""})`)
  c.eq((await v.table("pms_time_entries")).find((r) => r.id === "time_maya")?.approvalStatus, "submitted", "re-read: Maya's timesheet is still submitted (the demoted person's confirm changed nothing)")
  await v.setRole("sumeet", "manager")
  const restored = ((await aiW.get("/functions?format=json&per_page=100")).json.functions ?? []) as Json[]
  c.ok(restored.some((f) => f.id === "approve_timesheet"), "after the role is restored the same link carries approve_timesheet again")
  const fresh = await aiW.draft("approve_timesheet", { timeEntryId: "time_maya" }, key("post-demotion-draft"))
  const freshDone = await cx.sumeet.confirmFromUrl(String(fresh.json.confirm_url))
  c.ok(freshDone.json.status === "done", "a new draft confirmed by the restored manager is applied")
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Scenario 3: way three (AW-603), an AI given only the link reads the ZOOMIES workbook itself and fills a new project through the link
// ---------------------------------------------------------------------------------------------------------------------------------
async function way3(cx: Ctx): Promise<void> {
  const { t, c, v } = cx

  t.section("The person clicks \"New project with my AI\": a shell project and a link, nothing else")
  const made = await cx.sumeet.newProject()
  c.ok(made.status === 201 && made.json.shell === true && !!made.link && !!made.projectId, `the shell project and its link are made in one action (${made.status})`)
  cx.links.push({ id: linkIdOf(made.json), owner: "sumeet", revoked: false, address: made.link as string })
  const project = made.projectId as string
  const ai = new Ai(made.link as string, t, "AI")
  const ctxDoc = (await ai.get("/context?format=json")).json
  c.eq([ctxDoc.level, ctxDoc.effective_level], [0, 0], "the link of a shell project is made at level 0: the AI drafts, the person confirms")
  c.eq((await ai.records("boqs")).length, 0, "records/boqs: the shell project has no BOQ")
  c.eq((await ai.records("boq_lines")).length, 0, "records/boq_lines: the shell project has no lines")
  const direct0 = await ai.action("record_work_progress", { itemCode: "X", percent: 1 }, key("way3-level0"))
  c.ok(direct0.status === 403 && direct0.json.code === "LEVEL_NOT_ALLOWED", "a level-0 link cannot make a direct change (LEVEL_NOT_ALLOWED)")

  t.section("The AI opens the workbook itself (its own reading; the link is not involved)")
  // The external AI reads the file the person gave it. Here that is the public ZOOMIES fixture as an .xlsx, read with the same deterministic reader
  // the server uses (WP-01): a real AI would parse the sheets with its own tools. The lines, the areas and the printed totals below are what it found.
  const { zoomiesWorkbook } = await import("@/lib/services/__test-helpers__/zoomies-workbook")
  const { readWorkbookGrid } = await import("@/lib/ingest/parser")
  const { readMultisheetBills, toBoqLineItems } = await import("@/lib/ingest/multisheet-bill-reader")
  const found = readMultisheetBills(await readWorkbookGrid(zoomiesWorkbook()))
  // The manual's example writes a category as "Area / Bill" and the seal takes the area from the text before the first "/". The reader writes "Area - Bill",
  // so the AI rewrites the first separator, as the manual's example shows.
  const lines = toBoqLineItems(found).map((l) => ({ ...l, category: String(l.category ?? "").replace(" - ", " / ") }))
  cx.findings.push("The reader (WP-01) writes a category as \"<Area> - <Bill>\" and the seal (WP-04) takes the area from the text before the first \"/\": an AI that sends the reader categories unchanged cannot seal with per-area control totals (every category is its own area). The persona AI rewrites the separator as the manual example shows; the two conventions should be one.")
  const grand = found.totals.grand.declared ?? 0
  const areas = Object.fromEntries(found.totals.byArea.map((a) => [a.area, a.declaredMain ?? a.declaredSubtotal ?? a.computed])) as Record<string, number>
  c.eq(lines.length, 53, "the AI found 53 lines (50 priced, 3 lump sums the file prints as bill totals)")
  c.eq(grand, ZOOMIES_TOTAL, "the workbook prints a grand total of AED 1,596,280")
  c.eq(sumBy(lines as unknown as Json[], (l) => Number(l.quantity) * Number(l.rate)), ZOOMIES_TOTAL, "the AI's own lines add up to the printed grand total")
  t.note(`The AI's control totals per area: ${JSON.stringify(areas)}; grand ${grand}; ${lines.length} lines.`)

  t.section("The AI fills the project: rename, empty BOQ, lines in batches, control totals")
  const rename = await ai.draft("update_project", { name: found.projectName ?? "ZOOMIES", description: "Play Area and Vet Area fit-out" }, key("way3-rename"))
  c.eq(rename.status, 201, "update_project is drafted")
  const renamed = await cx.sumeet.confirmFromUrl(String(rename.json.confirm_url))
  c.ok(renamed.json.status === "done", "the person confirms the new name")
  c.eq((await v.table("projects")).find((p) => p.id === project)?.name, found.projectName, "re-read: the project carries the name the AI read from the workbook")

  const boqDraft = await ai.draft("create_boq", { title: `${found.projectName ?? "ZOOMIES"} BOQ`, idempotency_key: "way3-boq-1" }, key("way3-boq"))
  c.eq(boqDraft.status, 201, "create_boq (empty) is drafted")
  const boqDone = await cx.sumeet.confirmFromUrl(String(boqDraft.json.confirm_url))
  c.ok(boqDone.json.status === "done", "the person confirms the empty BOQ")
  const boqId = boqDone.json.record?.id as string
  c.eq((await v.table("construction_boq_line_items")).filter((l) => l.boqId === boqId).length, 0, "re-read: the BOQ exists with 0 lines")

  const batches: Json[][] = []
  for (let i = 0; i < lines.length; i += 25) batches.push(lines.slice(i, i + 25) as unknown as Json[])
  c.eq(batches.map((b) => b.length), [25, 25, 3], "53 lines are 3 batches of at most 25")
  let batchNo = 0
  for (const b of batches) {
    batchNo++
    const d = await ai.draft("add_boq_lines", { boqId, batchNo, lines: b }, key(`way3-batch-${batchNo}`))
    c.eq(d.status, 201, `add_boq_lines batch ${batchNo} (${b.length} lines) is drafted`)
    const done = await cx.sumeet.confirmFromUrl(String(d.json.confirm_url))
    c.ok(done.json.status === "done", `the person confirms batch ${batchNo}`)
    c.eq((await v.table("construction_boq_line_items")).filter((l) => l.boqId === boqId).length, Math.min(batchNo * 25, 53), `re-read: ${Math.min(batchNo * 25, 53)} lines are stored after batch ${batchNo}`)
  }
  // the same batch sent again with another draft: a replay by boq id and batch number, not a second copy
  const replay = await ai.draft("add_boq_lines", { boqId, batchNo: 2, lines: batches[1] }, key("way3-batch-2-again"))
  const replayDone = await cx.sumeet.confirmFromUrl(String(replay.json.confirm_url))
  c.ok(replayDone.json.status === "done", "batch 2 sent again is accepted as a replay")
  c.eq((await v.table("construction_boq_line_items")).filter((l) => l.boqId === boqId).length, 53, "re-read: still 53 lines, no copy of batch 2")

  const wrong = await ai.draft("seal_boq", { boqId, controlTotals: { areas, grand: grand + 1000 }, expectedLineCount: 53 }, key("way3-seal-wrong"))
  const wrongDone = await cx.sumeet.confirmFromUrl(String(wrong.json.confirm_url))
  c.ok(wrongDone.json.status === "failed" && /TOTAL/.test(String(wrongDone.json.code)), `a seal with control totals that do not match is refused (${wrongDone.json.status} ${wrongDone.json.code ?? ""})`)
  const sealedRows = async () => (await v.table("audit_logs")).filter((a) => a.action === "construction_boq.sealed" && a.entityId === boqId).length
  c.eq(await sealedRows(), 0, "re-read: the refused seal left no seal record")
  const seal = await ai.draft("seal_boq", { boqId, controlTotals: { areas, grand }, expectedLineCount: 53 }, key("way3-seal"))
  const sealDone = await cx.sumeet.confirmFromUrl(String(seal.json.confirm_url))
  c.ok(sealDone.json.status === "done", `the right control totals seal the BOQ (${sealDone.json.status} ${sealDone.json.code ?? ""} ${JSON.stringify(sealDone.json.missing ?? [])})`)
  c.eq(await sealedRows(), 1, "re-read: one seal record exists for the BOQ")
  const late = await ai.draft("add_boq_lines", { boqId, batchNo: 4, lines: [{ itemCode: "LATE-1", description: "A line after the seal", unit: "nos", quantity: 1, rate: 100, category: "Play Area / Late" }] }, key("way3-late"))
  const lateDone = await cx.sumeet.confirmFromUrl(String(late.json.confirm_url))
  c.ok(lateDone.json.status === "failed" && /SEALED/.test(String(lateDone.json.code)), `a sealed BOQ takes no more lines (${lateDone.json.status} ${lateDone.json.code ?? ""})`)

  t.section("Re-read from the database")
  const stored = (await v.table("construction_boq_line_items")).filter((l) => l.boqId === boqId)
  c.eq(stored.length, 53, "53 stored lines")
  c.eq(sumBy(stored, (l) => Number(l.quantity) * Number(l.rate)), ZOOMIES_TOTAL, "the stored lines add up to AED 1,596,280")
  c.eq(new Set(stored.map((l) => l.itemCode)).size, 53, "no item code is stored twice")
  const boqRow = (await v.table("construction_boqs")).find((b) => b.id === boqId)
  c.eq(boqRow?.createdById, SUMEET, "the BOQ is attributed to Sumeet")
  const audits = (await v.table("audit_logs")).filter((a) => String(a.action ?? "").startsWith("construction_boq"))
  c.ok(audits.length >= 3 && audits.every((a) => a.userId === SUMEET), `every BOQ audit row (${audits.length}) names Sumeet`)
  const readBack = await ai.records("boq_lines", 50)
  c.eq(readBack.length, 53, "records/boq_lines: the AI reads all 53 lines back through the link")
  const st = await v.state()
  const aiSubs = (st.tables.submissions ?? []).filter((s) => s.via === "ai_link")
  c.ok(aiSubs.length >= 7 && aiSubs.every((s) => s.userId === SUMEET && s.aiLinkId === linkIdOf(made.json) && Number(s.modelCalls) === 0), `each of the ${aiSubs.length} confirmed changes is a submission via ai_link by Sumeet on this link with model_calls 0`)
  c.ok((st.tables.pipeline_tasks ?? []).every((k) => k.executor === "ai"), "each task is executor ai")
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Scenario 4: cleanup (AW-703)
// ---------------------------------------------------------------------------------------------------------------------------------
async function cleanupRun(cx: Ctx): Promise<() => Promise<void>> {
  const { t, c, v, ids } = cx
  const project = ids.zoomiesProject as string
  t.section("Make a mess on purpose: four throwaway links and two demoted people")
  const a = await mintFor(cx, "sumeet", project, 1, "throwaway 1")
  const b = await mintFor(cx, "sumeet", ids.oakwoodProject as string, 0, "throwaway 2")
  const m = await mintFor(cx, "maya", project, 1, "throwaway 3")
  const w = await mintFor(cx, "vic", project, 0, "throwaway 4")
  c.ok([a, b, m, w].every((x) => x.status === 201), "four links were made")
  await v.setRole("maya", "viewer")
  await v.setRole("sumeet", "member")
  const roles = await v.roles()
  c.ok(roles.maya === "viewer" && roles.sumeet === "member", "two people are demoted (Sumeet to member, Maya to viewer)")
  c.eq((await v.links()).filter((l) => l.revoked_at === null).length, 4, "re-read: four links are active")
  const aiA = new Ai(a.link as string, t, "AI (throwaway 1)")
  c.eq((await aiA.get("/context?format=json")).status, 200, "a throwaway link works before the cleanup")
  // one live link per person and project: a second link for the same project revokes the first
  const again = await mintFor(cx, "sumeet", project, 1, "throwaway 1, again")
  c.eq((await aiA.get("/context?format=json")).status, 410, "a second link for the same person and project revokes the first (410 on its address)")
  c.eq((await new Ai(again.link as string, t, "AI (throwaway 1, again)").get("/context?format=json")).status, 200, "and the new one works")
  return async () => {
    t.section("After the cleanup")
    for (const l of [again, b, m, w]) c.eq((await new Ai(l.link as string, t, "AI (after cleanup)").get("/context?format=json")).status, 410, "a throwaway link answers 410 after the cleanup")
    const fresh = await mintFor(cx, "sumeet", project, 1, "after cleanup")
    const fns = ((await new Ai(fresh.link as string, t, "AI (fresh link)").get("/functions?format=json&per_page=100")).json.functions ?? []) as Json[]
    c.ok(fns.some((f) => f.id === "approve_timesheet"), "a fresh link of Sumeet carries the manager's functions again (the demotion is undone)")
    await revokeLink(cx, cx.links[cx.links.length - 1])
    c.eq((await v.links()).filter((l) => l.revoked_at === null).length, 0, "re-read: no link is active at the very end")
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------

async function main() {
  const t = new Transcript(`Persona run (${scenario}), dry mode, ${today}`, [
    "Run by the Claude Code session acting as the EXTERNAL AI, over plain HTTP against the local execution host in dry mode.",
    "The AI uses only the link address; the person's steps use a local session; the assertions re-read persisted rows. Tokens and confirm codes are cut to six characters.",
    "",
  ])
  const c = new Checks(t)
  const host = await startHost(scenario === "way3" ? "persona-empty" : "persona")
  const findings: string[] = []
  try {
    const v = new Verifier(host)
    const ids = await v.ids()
    const sumeet = new Person(host, t, await v.session("sumeet"), "Sumeet")
    const baseline = await v.roles()
    const cx: Ctx = { host, v, t, c, ids, sumeet, links: [], findings }
    let after: (() => Promise<void>) | null = null
    if (scenario === "zoomies") await zoomies(cx)
    else if (scenario === "roles") await roles(cx)
    else if (scenario === "way3") await way3(cx)
    else if (scenario === "cleanup") after = await cleanupRun(cx)
    else throw new Error(`unknown scenario ${scenario}`)
    await cleanup(cx, baseline)
    if (after) await after()
    if (findings.length) {
      t.section("Findings (real behaviour of the link that the run met; not failures)")
      for (const f of findings) t.note(`- ${f}`)
    }
  } catch (e) {
    c.ok(false, `the run stopped: ${String((e as Error).message).slice(0, 300)}`)
    console.error(String((e as Error).stack ?? e).slice(0, 1500))
  } finally {
    if (process.env.PERSONA_SHOW_HOST_LOG) console.error(host.log().slice(-6000))
    if (process.env.PERSONA_DUMP) {
      const st = await new Verifier(host).state().catch(() => null)
      if (st) for (const [name, rows] of Object.entries(st.tables)) if (rows.length && rows.length < 30) console.error(`DUMP ${name} ${rows.length} ${JSON.stringify(rows[rows.length - 1]).slice(0, 500)}`)
    }
    host.stop()
  }
  mkdirSync(outDir, { recursive: true })
  const file = resolve(outDir, `${today}-dry-${scenario === "zoomies" ? "" : `${scenario}-`}transcript.md`)
  t.write(file)
  if (c.failed.length) {
    for (const f of c.failed) console.error(`FAIL: ${f}`)
    console.error(`PERSONA ${scenario} FAIL passed=${c.passed} failed=${c.failed.length} transcript=${file}`)
    process.exit(1)
  }
  console.log(`PERSONA ${scenario} PASS assertions=${c.passed} transcript=${file}`)
}

await main()
