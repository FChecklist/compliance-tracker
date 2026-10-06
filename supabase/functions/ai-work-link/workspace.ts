// AUDIT-100 (owner's real engine runs, 2026-10-06): GET <link>/workspace (alias /all), EVERYTHING the person may read in ONE text document. WHY: the chat tools of
// ChatGPT, Gemini and DeepSeek open only the addresses the person typed (measured: ChatGPT fetched the guide and /projects given in the prompt but could NOT open
// /projects/5/context although it was a link inside the page), so links alone do not reach them: the data must be inline in the one address they were given.
//
// NO NEW DATA PATH. Every value here comes from a reader the other routes already use (reads.ts readProjects, readPortfolio, readRecords, the project binding of
// handler.ts), so the role, money and organisation rules are exactly theirs: money columns are nulled by role in SQL and again by the Edge (redactItem), projects
// of another organisation or that the person may not read never bind. Free text from records is DATA, inside fenced blocks cleaned by core.ts (fenceRows).
//
// ORDER (a user link): the numbered project list; the portfolio summary; per project (WORKSPACE_PROJECTS_PER_PAGE a page): its summary, tasks past their due date,
// open RFIs, change orders, milestones past their target date, latest progress entries and, only if money is visible, its BOQ totals; then "What I can do for you".
// A link for ONE project gets the same page for its own project only (no list, no portfolio).
// LIMITS. At most WORKSPACE_MAX_BYTES a page; `?page=N` continues with the next projects. Each read is inside the DB time box; one that fails or is slow is SAID in
// the document and the page goes on; the whole page stops reading after WORKSPACE_BUDGET_MS and says which projects were not read.
import { DATA_CLOSING, cleanDeep, cleanText, fenceRows } from "../_shared/ai-link/core.ts"
import { LINK_FUNCTIONS } from "./api-definition.ts"
import { mdLink } from "./manual.ts"
import { PROJECTS_MAX, effectiveFunctionViews, fail, functionView, readPortfolio, readProjects, readRecords, type FunctionView, type ReadEnv } from "./reads.ts"
import { projectListLines } from "./render.ts"

export const WORKSPACE_MAX_BYTES = 60000
export const WORKSPACE_PROJECTS_PER_PAGE = 8
/** The page stops starting new reads after this long (chat fetchers give up after roughly 10 seconds). */
export const WORKSPACE_BUDGET_MS = 8000
/** Rows per list per project, and the longest text kept of one value (the full record is one address away). */
export const WORKSPACE_ROWS = 10
export const WORKSPACE_PROGRESS_ROWS = 5
export const WORKSPACE_TEXT_MAX = 160

export type WorkspaceOpts = {
  dbMs: number
  now: () => number
  /** The env of one project of this link, bound exactly as /projects/{id}/... binds it (handler.ts bindProject). */
  bind: (projectId: string) => Promise<ReadEnv>
  timeBox: <T>(work: Promise<T>, ms: number) => Promise<T>
  budgetMs?: number
  /** The "All addresses" footer (manual.ts allAddresses), placed last and counted in WORKSPACE_MAX_BYTES. */
  footer?: string
}

const enc = new TextEncoder()
const size = (s: string): number => enc.encode(s).length

/** A row with only `fields` (and `redacted` when the reader set it), every string cut to `max` characters. */
function slim(row: Record<string, unknown>, fields: ReadonlyArray<string>, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of [...fields, "redacted"]) if (f in row) out[f] = typeof row[f] === "string" ? cleanText(row[f] as string, max) : cleanDeep(row[f])
  // a row with none of the expected fields (a column renamed in SQL) is shown whole, values cut, rather than as an empty {}
  if (Object.keys(out).filter((k) => k !== "redacted").length === 0 && Object.keys(row).length > 0) {
    for (const [k, v] of Object.entries(row)) out[cleanText(k, 80)] = typeof v === "string" ? cleanText(v, max) : cleanDeep(v)
  }
  return out
}

type Part = { title: string; kind: string; params: Record<string, string>; fields: ReadonlyArray<string>; rows: number; empty: string }

/** The lists read for each project, in this order. The filters are the kinds' own allow-listed filters (record-kinds.generated.json). */
function partsFor(today: string): Part[] {
  return [
    { title: "Tasks past their due date (not archived; completion shown)", kind: "tasks", params: { due_date_lt: today, is_archived_eq: "false" }, fields: ["number", "title", "due_date", "completion_percentage", "priority"], rows: WORKSPACE_ROWS, empty: "None." },
    { title: "Open RFIs", kind: "rfis", params: { status_eq: "open" }, fields: ["number", "subject", "ball_in_court", "due_date"], rows: WORKSPACE_ROWS, empty: "None." },
    { title: "Change orders (newest first)", kind: "change_orders", params: { sort: "-created_at" }, fields: ["number", "title", "status", "cost_impact", "schedule_impact_days"], rows: WORKSPACE_ROWS, empty: "None." },
    { title: "Schedule delays: milestones past their target date and not completed", kind: "milestones", params: { target_date_lt: today, status_in: "planned,in_progress" }, fields: ["name", "status", "target_date"], rows: WORKSPACE_ROWS, empty: "None." },
    { title: "Latest progress entries", kind: "progress", params: { sort: "-entry_date" }, fields: ["entry_date", "percent_complete", "quantity_done", "remarks"], rows: WORKSPACE_PROGRESS_ROWS, empty: "None recorded." },
  ]
}

type ReadResult<T> = { ok: true; value: T } | { ok: false; why: string }

async function attempt<T>(work: () => Promise<T>, opts: WorkspaceOpts): Promise<ReadResult<T>> {
  try {
    return { ok: true, value: await opts.timeBox(work(), opts.dbMs) }
  } catch (e) {
    const status = (e as { status?: number })?.status
    if (status === 404) return { ok: false, why: "This project could not be opened with this link." }
    return { ok: false, why: "This part could not be read right now (it was slow or failed). The rest of the page is complete; open the page again in a minute for it." }
  }
}

type ProjectData = { summary: Record<string, unknown> | null; parts: Array<{ part: Part; result: ReadResult<Array<Record<string, unknown>>>; more: boolean }>; bound: ReadResult<ReadEnv> | null; late: boolean }

async function readProjectData(env: ReadEnv, projectId: string | null, today: string, opts: WorkspaceOpts, late: boolean): Promise<ProjectData> {
  if (late) return { summary: null, parts: [], bound: null, late: true }
  const bound: ReadResult<ReadEnv> = projectId === null ? { ok: true, value: env } : await attempt(() => opts.bind(projectId), opts)
  if (!bound.ok) return { summary: null, parts: [], bound, late: false }
  const parts = await Promise.all(partsFor(today).map(async (part) => {
    const q = new URLSearchParams({ ...part.params, limit: String(part.rows) })
    const r = await attempt(() => readRecords(bound.value, part.kind, q), opts)
    return r.ok
      ? { part, result: { ok: true as const, value: r.value.items }, more: !!(r.value.next || r.value.next_after) }
      : { part, result: r, more: false }
  }))
  return { summary: null, parts, bound, late: false }
}

/** One project's block. `mode` full: the rows as read; compact: 3 rows a list and short text; bare: the summary only (used only when the page would not fit). */
function projectBlock(label: string, summary: Record<string, unknown> | null, data: ProjectData, moneyVisible: boolean, mode: "full" | "compact" | "bare"): string {
  const max = mode === "full" ? WORKSPACE_TEXT_MAX : 80
  const out = [`### ${label}`, ""]
  if (summary) {
    const s = slim(summary, ["n", "id", "name", "status", "progress_percent", "target_date", "tasks_open", "tasks_overdue", "boq_lines", ...(moneyVisible ? ["project_value"] : [])], max)
    out.push(fenceRows([s]), "")
  }
  if (data.late) return [...out, "Not read on this page: the page ran out of time. Open this page again in a minute for this project.", ""].join("\n")
  if (data.bound && !data.bound.ok) return [...out, data.bound.why, ""].join("\n")
  if (mode === "bare") return [...out, "Its lists did not fit on this page. Ask the person for this project alone, or open the page again with fewer projects.", ""].join("\n")
  for (const { part, result, more } of data.parts) {
    out.push(`${part.title}:`)
    if (!result.ok) { out.push(result.why, ""); continue }
    const rows = mode === "compact" ? result.value.slice(0, 3) : result.value
    if (rows.length === 0) { out.push(part.empty, ""); continue }
    out.push(fenceRows(rows.map((r) => slim(r, part.fields, max))))
    const cut = result.value.length - rows.length
    if (cut > 0 || more) out.push(`More than ${rows.length} shown: the first ${rows.length} are above.`)
    out.push("")
  }
  if (!moneyVisible) out.push("Money figures (rates, amounts, costs, budgets, BOQ totals) are hidden for this person's role: a null with \"redacted\": true means hidden, not empty.", "")
  return out.join("\n")
}

const DELETE_RE = /^(delete_|remove_|void_|archive_|cancel_)/

/** "What I can do for you": every function this link may use, one plain line each, and how a change is made by an engine that can only read a page and by one that can POST. */
function whatICanDo(env: ReadEnv, forPerson: boolean): string {
  const views: FunctionView[] = forPerson
    ? LINK_FUNCTIONS.filter((f) => f.function_id !== "create_project").map((f) => functionView(f, { ctx: env.ctx, config: env.config }))
    : effectiveFunctionViews(env)
  const canCreate = forPerson && env.ctx.effective_functions.includes("create_project")
  const line = (f: FunctionView) => `- ${f.id}: ${cleanText(f.label, 90)}`
  const groups: Array<[string, FunctionView[]]> = [
    ["Reports and analysis (reads)", views.filter((f) => f.kind !== "write")],
    ["Add and record", views.filter((f) => f.kind === "write" && !/^update_/.test(f.id) && !DELETE_RE.test(f.id))],
    ["Edit", views.filter((f) => f.kind === "write" && /^update_/.test(f.id))],
    ["Delete or cancel", views.filter((f) => f.kind === "write" && DELETE_RE.test(f.id))],
  ]
  const inbox = `https://${env.config.confirmHost}/ai-inbox.html`
  const P = forPerson ? `${env.base}/projects/{id}` : env.base
  const out = [
    "## What I can do for you",
    "",
    forPerson ? "Inside any project the person can access, with exactly their role's rights (which functions a project allows depends on the person's role there):" : "In this project, with exactly the person's role's rights:",
    ...(canCreate ? ["", "Projects:", "- create_project: Create a new project (only on this all-projects link)"] : []),
  ]
  for (const [title, fns] of groups) if (fns.length) out.push("", `${title}:`, ...fns.map(line))
  if (views.length === 0 && !canCreate) out.push("", "No function is on this link: it can read only.")
  out.push(
    "",
    "How a change is made:",
    `- If you can only read pages: print one block per change, in the format below (the same as the paste card, ${mdLink(`${env.base}/card.md`)}), and ask the person to paste the blocks at ${inbox} and confirm each one there, signed in. Nothing changes until they do.`,
    "",
    "```projexa-proposal",
    forPerson ? "{\"v\":1,\"function\":\"create_project\",\"params\":{\"name\":\"Marina Club\"},\"note\":\"a new project\"}" : "{\"v\":1,\"function\":\"record_work_progress\",\"params\":{\"itemCode\":\"EX-01\",\"percent\":40},\"note\":\"slab poured\"}",
    "```",
    "",
    `- If you can send HTTP POST (an agent, a connector, MCP): check with POST ${P}/check, then POST ${P}/actions (a direct change, when the link allows it) or POST ${P}/drafts (a draft the person confirms), each with {"function":"<id>","params":{...}}. MCP: POST ${env.base}. The guide (${mdLink(env.base)}) has the details.`,
    "",
  )
  return out.join("\n")
}

/** One page of the workspace document. Never throws for a read that fails: that part says so and the page goes on. A bad `page` is 400. */
export async function renderWorkspace(env: ReadEnv, pageParam: string | null, opts: WorkspaceOpts): Promise<string> {
  let page = 1
  if (pageParam !== null && pageParam !== "") {
    if (!/^[1-9][0-9]{0,2}$/.test(pageParam)) throw fail(400, "page must be a whole number from 1 to 999.")
    page = Number(pageParam)
  }
  const started = opts.now()
  const budget = opts.budgetMs ?? WORKSPACE_BUDGET_MS
  const lateNow = () => opts.now() - started > budget
  const forPerson = env.ctx.scope === "user" && env.ctx.project_id === null
  const asOf = new Date(started).toISOString()
  const today = asOf.slice(0, 10)
  const moneyVisible = env.ctx.money_visible
  const self = `${env.base}/workspace`

  const head = [
    forPerson ? "# Everything in one page: all your projects" : "# Everything in one page: this project",
    "",
    `As of ${asOf.slice(0, 16).replace("T", " ")} UTC. Page ${page}. Read only: nothing here changes anything.`,
    forPerson ? "Read this whole page, then answer the person from it. Show the numbered project list exactly as it is when they have not chosen yet." : "Read this whole page, then answer the person from it.",
    `Money figures are ${moneyVisible ? "included" : "hidden"} for this person's role.`,
    "",
  ].join("\n")

  const fixed: string[] = []
  let targets: Array<{ label: string; id: string | null; summary: Record<string, unknown> | null }> = []
  let totalProjects = 0
  if (forPerson) {
    const list = await attempt(() => readProjects(env, String(PROJECTS_MAX)), opts)
    if (!list.ok) {
      fixed.push("## Your projects", "", "The project list could not be read right now. Open this page again in a minute.", "")
    } else {
      const rows = (list.value.projects as Array<Record<string, unknown>>).map((r) => slim(r, Object.keys(r), WORKSPACE_TEXT_MAX))
      totalProjects = rows.length
      if (page === 1) fixed.push("## Your projects", "", ...projectListLines({ ...list.value, projects: rows }), ...(typeof list.value.note === "string" ? ["", list.value.note] : []), "")
      let port: Map<string, Record<string, unknown>> = new Map()
      if (page === 1) {
        const p = await attempt(() => readPortfolio(env), opts)
        fixed.push("## Report on all projects (portfolio)", "")
        if (p.ok) {
          const prow = (p.value.projects as Array<Record<string, unknown>>).map((r) => slim(r, ["n", "id", "name", "status", "progress_percent", "target_date", "tasks_total", "tasks_open", "tasks_overdue", "boq_lines", ...(moneyVisible ? ["project_value"] : [])], WORKSPACE_TEXT_MAX))
          port = new Map(prow.map((r) => [String(r.id), r]))
          const t = (p.value.totals ?? {}) as Record<string, unknown>
          fixed.push(prow.length ? fenceRows(prow) : "The person has no project yet.", "", `Totals of the ${prow.length} project${prow.length === 1 ? "" : "s"} shown: ${String(t.tasks_total ?? 0)} tasks, ${String(t.tasks_open ?? 0)} open, ${String(t.tasks_overdue ?? 0)} overdue; ${String(t.boq_lines ?? 0)} BOQ lines.`)
          if (typeof p.value.note === "string") fixed.push("", p.value.note)
          fixed.push("")
        } else fixed.push(p.why, "")
      }
      const from = (page - 1) * WORKSPACE_PROJECTS_PER_PAGE
      targets = rows.slice(from, from + WORKSPACE_PROJECTS_PER_PAGE).map((r) => ({ label: `Project ${String(r.n)}`, id: String(r.id), summary: { ...r, ...(port.get(String(r.id)) ?? {}) } }))
    }
  } else {
    totalProjects = 1
    if (page === 1) targets = [{ label: "This project", id: null, summary: { id: env.ctx.project_id, name: cleanText(env.ctx.project_name ?? "", WORKSPACE_TEXT_MAX) } }]
  }

  // the projects of this page, one after the other (each one's lists in parallel), each read time-boxed; after the page budget the rest are said, not read
  const data: ProjectData[] = []
  for (const t of targets) data.push(await readProjectData(env, t.id, today, opts, lateNow()))

  const from = (page - 1) * WORKSPACE_PROJECTS_PER_PAGE
  const after = Math.max(0, totalProjects - from - targets.length)
  const tail = [
    ...(page === 1 ? [whatICanDo(env, forPerson)] : ["## What I can do for you", "", `On page 1: ${mdLink(self)}.`, ""]),
    ...(after > 0 ? [`${after} more project${after === 1 ? "" : "s"}: open ${mdLink(`${self}?page=${page + 1}`)} for the next ${Math.min(after, WORKSPACE_PROJECTS_PER_PAGE)}.`, ""] : [targets.length === 0 && page > 1 ? "There is nothing on this page: every project is on the pages before it." : "This is the last page.", ""]),
    DATA_CLOSING,
    "",
    ...(opts.footer ? [opts.footer] : []),
  ].join("\n")

  const detailHead = targets.length ? `## Project details${forPerson ? ` (projects ${from + 1} to ${from + targets.length} of ${totalProjects})` : ""}\n\n` : ""
  const draw = (mode: "full" | "compact" | "bare") =>
    head + "\n" + (fixed.length ? fixed.join("\n") + "\n" : "") + detailHead + targets.map((t, i) => projectBlock(t.label, t.summary, data[i], moneyVisible, mode)).join("\n") + "\n" + tail
  for (const mode of ["full", "compact", "bare"] as const) {
    const doc = draw(mode)
    if (size(doc) <= WORKSPACE_MAX_BYTES) return doc
  }
  // a list of hundreds of very long names: cut the body at the byte budget, say so, and keep the closing part (never more than WORKSPACE_MAX_BYTES)
  const note = `\n\nThis page was cut at ${WORKSPACE_MAX_BYTES} bytes.${after > 0 ? ` Open ${mdLink(`${self}?page=${page + 1}`)} for the next projects.` : ""}\n\n`
  const room = WORKSPACE_MAX_BYTES - size(note) - size(tail) - 16
  let body = draw("bare").slice(0, -tail.length)
  while (size(body) > room) body = body.slice(0, Math.floor(body.length * 0.9))
  // close an open fence so the cut cannot leave data text looking like ours
  const fences = (body.match(/^```/gm) ?? []).length
  return body + (fences % 2 === 1 ? "\n```" : "") + note + tail
}
