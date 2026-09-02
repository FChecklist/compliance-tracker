// R67 lane B (B-03) -- THE LEVELS ENDPOINT'S BRAIN: modules -> verbs ->
// records -> the card schema.
//
// WHY THIS EXISTS. PROJEXA's composer can start a chain (the pill strip) and
// can run a finished one (POST /api/v1/projexa/tasks), but between those two
// there was nothing: no endpoint could answer "the user has picked Work
// Progress and Record progress -- now what are their real choices?". The kit
// ships an OptionChain component with zero consumers for exactly that
// reason. Every second level was therefore a free-text guess, which is how
// "record 50% on excavation" ended up as a blocked task naming a line the
// project does not have.
//
// THE RULES THIS FILE HOLDS TO:
//   1. ONE withTenantContext PER REQUEST. A level needs exactly one read, so
//      the repo below exposes one method per level and buildChainOptions()
//      calls at most one of them. This deliberately does NOT compose
//      listBoqs() + getBoq() (two transactions on a five-connection pool --
//      the /scope N+1 pattern, ~8 s), it runs their two queries inside one.
//   2. THE OPTION LIST IS A HINT, NEVER AN AUTHORISATION. Every leaf resolves
//      to a {functionId, params} that tasks/route.ts re-validates for
//      permission and existence on submit, or to a real route.
//   3. LEGENDS ARE SERVER-OWNED SENTENCES ("Which BOQ line?"), so the client
//      never composes a question and two surfaces can never ask it
//      differently.
//   4. AN UNPICKABLE OPTION IS SHOWN WITH ITS REASON, NOT HIDDEN. A parent
//      BOQ line is still the row the user is looking for; hiding it makes
//      the list look wrong, so it is listed and disabled with the reason.
import { and, asc, desc, eq } from "drizzle-orm"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { constructionBoqLineItems, constructionBoqs, constructionLabourRoster } from "@/lib/db/schema"
import { functionSpec, type CardSchema } from "@/lib/pipeline/function-registry"

export type ChainOptionNext = "card" | "route" | "ask" | "run"

export type ChainOption = {
  id: string
  label: string
  /** true when picking this needs no further choice before the card/route. */
  isLeaf: boolean
  /** set exactly when this option cannot be picked, and says why in one sentence. */
  unavailableReason?: string
  next: ChainOptionNext
  functionId?: string
  params?: Record<string, unknown>
  route?: string
  schema?: CardSchema
  /** the heading this option sits under (attendance is grouped by trade). */
  group?: string
  /** preselected when the level opens (attendance: everyone present). */
  selected?: boolean
}

export type ChainOptionsResult = {
  /** The question, as a human sentence. Server-owned. */
  legend: string
  kind: "module" | "verb" | "record" | "parameter" | "version"
  options: ChainOption[]
  /** true when the level takes several picks at once (attendance). */
  multi?: boolean
  /** parameter values already filled in, so the level opens answered. */
  defaults?: Record<string, unknown>
}

export type BoqLineRow = {
  id: string
  itemCode: string | null
  description: string
  unit: string
  childCount: number
}

export type BoqVersionRow = { id: string; version: number; title: string; status: string }
export type RosterRow = { id: string; name: string; trade: string | null; employeeCode: string | null }

/**
 * The one seam between the levels and the database. Injectable so every
 * level's shape is unit-testable against a fixture project with no DB, the
 * same pattern level0.ts's L0Repo and derive-chain.ts's ChainRepo already
 * established in this codebase.
 */
export type ChainOptionsRepo = {
  latestBoqLines(projectId: string): Promise<{ boqId: string; version: number; lines: BoqLineRow[] } | null>
  boqVersions(projectId: string): Promise<BoqVersionRow[]>
  roster(projectId: string): Promise<RosterRow[]>
}

// ── The catalogue of modules and their verbs ───────────────────────────────
// Deliberately small and closed: these are the chains R66 actually asked for,
// each ending in a real function or a real route. A verb with no backing
// executor and no route does not belong here -- it would be a dead end, and
// M24 forbids dead ends.
type VerbDef = {
  id: string
  label: string
  /** the level this verb opens; "leaf" means the verb itself finishes the chain */
  opens: "boq-line" | "roster" | "boq-version" | "report-parameters" | "leaf"
  next: ChainOptionNext
  functionId?: string
  route?: string
}

type ModuleDef = { id: string; label: string; verbs: VerbDef[] }

const MODULES: readonly ModuleDef[] = [
  {
    id: "work_progress",
    label: "Work Progress",
    verbs: [
      { id: "record_progress", label: "Record progress", opens: "boq-line", next: "card", functionId: "record_work_progress" },
      { id: "view_progress", label: "View progress", opens: "leaf", next: "route", route: "/work-progress" },
    ],
  },
  {
    id: "manpower",
    label: "Manpower",
    verbs: [
      { id: "mark_attendance", label: "Mark attendance", opens: "roster", next: "card", functionId: "record_attendance" },
      { id: "add_worker", label: "Add a worker", opens: "leaf", next: "route", route: "/labour/new" },
      { id: "view_roster", label: "View roster", opens: "leaf", next: "route", route: "/labour" },
    ],
  },
  {
    id: "scope",
    label: "Scope (BOQ)",
    verbs: [
      { id: "new_revision", label: "New BOQ revision", opens: "boq-version", next: "route" },
      { id: "view_scope", label: "View scope", opens: "leaf", next: "route", route: "/scope" },
    ],
    // "Import BOQ" is deliberately absent: the importer exists server-side
    // (POST /api/v1/projexa/scope/import) but PROJEXA has no page route for
    // it yet, and offering a chain that ends in a 404 is the dead end M24
    // forbids. It joins this list in the same programme as its screen.
  },
  {
    id: "reports",
    label: "Reports",
    verbs: [
      { id: "work_progress_report", label: "Work Progress Report", opens: "report-parameters", next: "run" },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    verbs: [{ id: "review_budget", label: "Review Budget", opens: "leaf", next: "ask", functionId: "review_budget" }],
  },
]

export const CHAIN_OPTION_LEGENDS = {
  module: "What are you working on?",
  verb: "What do you want to do?",
  boqLine: "Which BOQ line?",
  worker: "Which worker?",
  boqVersion: "From which version?",
  reportParameters: "Which period?",
} as const

function moduleOptions(): ChainOptionsResult {
  return {
    legend: CHAIN_OPTION_LEGENDS.module,
    kind: "module",
    options: MODULES.map((m) => ({ id: m.id, label: m.label, isLeaf: false, next: "card" as const })),
  }
}

function verbOptions(module: ModuleDef): ChainOptionsResult {
  return {
    legend: CHAIN_OPTION_LEGENDS.verb,
    kind: "verb",
    options: module.verbs.map((v) => ({
      id: v.id,
      label: v.label,
      isLeaf: v.opens === "leaf",
      next: v.next,
      functionId: v.functionId,
      route: v.route,
      schema: v.functionId ? functionSpec(v.functionId)?.card : undefined,
    })),
  }
}

/** No project selected, but this level is about one project's records. */
function needsProject(legend: string, kind: ChainOptionsResult["kind"]): ChainOptionsResult {
  return {
    legend,
    kind,
    options: [
      {
        id: "project",
        label: "Pick a project",
        isLeaf: false,
        next: "route",
        route: "/dashboard",
        unavailableReason: "Pick a project in the top rail first",
      },
    ],
  }
}

export type BuildChainOptionsInput = {
  /** the segments already chosen, e.g. ["work_progress", "record_progress"] */
  path: readonly string[]
  projectId: string | null
}

/**
 * PURE apart from the ONE repo call each level makes. Never more than one --
 * see rule 1 in this file's header.
 */
export async function buildChainOptions(input: BuildChainOptionsInput, repo: ChainOptionsRepo): Promise<ChainOptionsResult> {
  const [moduleId, verbId] = input.path

  if (!moduleId) return moduleOptions()

  const module = MODULES.find((m) => m.id === moduleId)
  if (!module) return moduleOptions()

  if (!verbId) return verbOptions(module)

  const verb = module.verbs.find((v) => v.id === verbId)
  if (!verb) return verbOptions(module)

  switch (verb.opens) {
    case "boq-line":
      return boqLineOptions(input.projectId, verb, repo)
    case "roster":
      return rosterOptions(input.projectId, verb, repo)
    case "boq-version":
      return boqVersionOptions(input.projectId, repo)
    case "report-parameters":
      return reportParameterOptions(input.projectId)
    case "leaf":
    default:
      // The verb itself finished the chain -- hand back the one option that
      // says so, so the client never has to special-case an empty level.
      return {
        legend: CHAIN_OPTION_LEGENDS.verb,
        kind: "verb",
        options: [
          {
            id: verb.id,
            label: verb.label,
            isLeaf: true,
            next: verb.next,
            functionId: verb.functionId,
            route: verb.route,
            params: input.projectId ? { projectId: input.projectId } : undefined,
            schema: verb.functionId ? functionSpec(verb.functionId)?.card : undefined,
          },
        ],
      }
  }
}

/**
 * "Which BOQ line?" -- every leaf line of the project's latest BOQ, with the
 * parents listed and disabled. The parent rule is the one
 * construction-progress-service.ts already enforces at write time
 * (T-WPR-15-1): a parent's percent is derived from its children and must
 * never be stored directly, so offering one here would be offering a click
 * that is guaranteed to fail.
 */
async function boqLineOptions(projectId: string | null, verb: VerbDef, repo: ChainOptionsRepo): Promise<ChainOptionsResult> {
  if (!projectId) return needsProject(CHAIN_OPTION_LEGENDS.boqLine, "record")
  const boq = await repo.latestBoqLines(projectId)
  const schema = verb.functionId ? functionSpec(verb.functionId)?.card : undefined
  if (!boq || boq.lines.length === 0) {
    return {
      legend: CHAIN_OPTION_LEGENDS.boqLine,
      kind: "record",
      options: [
        {
          id: "new_boq",
          label: "Create a BOQ",
          isLeaf: false,
          next: "route",
          route: "/scope/new",
          unavailableReason: "This project has no BOQ yet",
        },
      ],
    }
  }
  return {
    legend: CHAIN_OPTION_LEGENDS.boqLine,
    kind: "record",
    options: boq.lines.map((line) => {
      const label = line.itemCode ? `${line.itemCode} ${line.description}` : line.description
      if (line.childCount > 0) {
        return {
          id: line.id,
          label,
          isLeaf: false,
          next: verb.next,
          unavailableReason: `Parent line - pick one of its ${line.childCount} sub-items`,
        }
      }
      return {
        id: line.id,
        label,
        isLeaf: true,
        next: verb.next,
        functionId: verb.functionId,
        params: { projectId, boqLineItemId: line.id, itemCode: line.itemCode ?? undefined },
        schema,
      }
    }),
    defaults: { projectId, boqVersion: boq.version },
  }
}

/**
 * "Which worker?" -- the roster grouped by trade, every worker preselected.
 * Sumeet marks a whole crew present and corrects the two who are not, so the
 * useful default is everyone selected, not an empty list.
 */
async function rosterOptions(projectId: string | null, verb: VerbDef, repo: ChainOptionsRepo): Promise<ChainOptionsResult> {
  if (!projectId) return needsProject(CHAIN_OPTION_LEGENDS.worker, "record")
  const roster = await repo.roster(projectId)
  const schema = verb.functionId ? functionSpec(verb.functionId)?.card : undefined
  if (roster.length === 0) {
    return {
      legend: CHAIN_OPTION_LEGENDS.worker,
      kind: "record",
      multi: true,
      options: [
        {
          id: "add_worker",
          label: "Add a worker",
          isLeaf: false,
          next: "route",
          route: "/labour/new",
          unavailableReason: "This project has nobody on its roster yet",
        },
      ],
    }
  }
  const today = new Date().toISOString().slice(0, 10)
  return {
    legend: CHAIN_OPTION_LEGENDS.worker,
    kind: "record",
    multi: true,
    options: roster.map((w) => ({
      id: w.id,
      label: w.employeeCode ? `${w.name} (${w.employeeCode})` : w.name,
      group: w.trade ?? "Unassigned trade",
      isLeaf: true,
      selected: true,
      next: verb.next,
      functionId: verb.functionId,
      params: { projectId, rosterId: w.id, date: today, status: "present" },
      schema,
    })),
    defaults: { projectId, date: today, status: "present" },
  }
}

/** "From which version?" -- a revision always starts from an existing BOQ. */
async function boqVersionOptions(projectId: string | null, repo: ChainOptionsRepo): Promise<ChainOptionsResult> {
  if (!projectId) return needsProject(CHAIN_OPTION_LEGENDS.boqVersion, "version")
  const versions = await repo.boqVersions(projectId)
  if (versions.length === 0) {
    return {
      legend: CHAIN_OPTION_LEGENDS.boqVersion,
      kind: "version",
      options: [
        {
          id: "new_boq",
          label: "Create a BOQ",
          isLeaf: false,
          next: "route",
          route: "/scope/new",
          unavailableReason: "This project has no BOQ to revise yet",
        },
      ],
    }
  }
  return {
    legend: CHAIN_OPTION_LEGENDS.boqVersion,
    kind: "version",
    options: versions.map((v) => ({
      id: v.id,
      label: `${v.title} (v${v.version})`,
      isLeaf: true,
      next: "route" as const,
      // The REAL revision route. B-03's brief wrote this as
      // "/scope/new?from=<id>", but /scope/new is the blank new-BOQ form and
      // does not read `from`, while /scope/[id]/revise is the shipped page
      // that opens a revision OF that version -- which is what the user just
      // asked for. Routing to the real screen rather than the brief's
      // spelling of it.
      route: `/scope/${v.id}/revise`,
    })),
  }
}

/**
 * The report's parameters as chips, ALREADY ANSWERED. R66's finding was that
 * the WPR shows "Pick a date range and click Run Report" over a range that is
 * already filled in; the level opens with this month selected so the only
 * remaining click is Run.
 */
function reportParameterOptions(projectId: string | null): ChainOptionsResult {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const to = now.toISOString().slice(0, 10)
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
  const previousMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10)
  const route = (f: string, t: string) =>
    `/work-progress?tab=report&from=${f}&to=${t}${projectId ? `&projectId=${projectId}` : ""}`
  return {
    legend: CHAIN_OPTION_LEGENDS.reportParameters,
    kind: "parameter",
    options: [
      { id: "this_month", label: "This month", isLeaf: true, selected: true, next: "run", route: route(from, to) },
      {
        id: "last_month",
        label: "Last month",
        isLeaf: true,
        next: "run",
        route: route(previousMonthStart, previousMonthEnd),
      },
    ],
    defaults: { from, to, view: "scope", projectId: projectId ?? undefined },
  }
}

// ── The real repo. ONE withTenantContext per method; a request calls one. ──
export function makeChainOptionsRepo(ctx: { orgId: string; userId?: string }): ChainOptionsRepo {
  return {
    async latestBoqLines(projectId: string) {
      return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
        // Same deterministic "latest" as construction-boq-service.listBoqs
        // and executor.ts: version DESC then createdAt DESC.
        const boq = await db.query.constructionBoqs.findFirst({
          where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)),
          orderBy: [desc(constructionBoqs.version), desc(constructionBoqs.createdAt)],
        })
        if (!boq) return null
        const rows = await db
          .select({
            id: constructionBoqLineItems.id,
            itemCode: constructionBoqLineItems.itemCode,
            description: constructionBoqLineItems.description,
            unit: constructionBoqLineItems.unit,
            parentLineItemId: constructionBoqLineItems.parentLineItemId,
          })
          .from(constructionBoqLineItems)
          .where(eq(constructionBoqLineItems.boqId, boq.id))
          .orderBy(asc(constructionBoqLineItems.itemCode))
        // "Parent" means "some other line points at it", exactly the rule
        // construction-progress-service.ts enforces at write time -- not
        // "parentLineItemId is null", which would disable every standalone
        // line in a flat BOQ.
        const childCounts = new Map<string, number>()
        for (const r of rows) {
          if (r.parentLineItemId) childCounts.set(r.parentLineItemId, (childCounts.get(r.parentLineItemId) ?? 0) + 1)
        }
        return {
          boqId: boq.id,
          version: boq.version,
          lines: rows.map((r) => ({
            id: r.id,
            itemCode: r.itemCode,
            description: r.description,
            unit: r.unit,
            childCount: childCounts.get(r.id) ?? 0,
          })),
        }
      })
    },

    async boqVersions(projectId: string) {
      return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
        const rows = await db
          .select({
            id: constructionBoqs.id,
            version: constructionBoqs.version,
            title: constructionBoqs.title,
            status: constructionBoqs.status,
          })
          .from(constructionBoqs)
          .where(and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)))
          .orderBy(desc(constructionBoqs.version), desc(constructionBoqs.createdAt))
        return rows
      })
    },

    async roster(projectId: string) {
      return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
        const rows = await db
          .select({
            id: constructionLabourRoster.id,
            name: constructionLabourRoster.name,
            trade: constructionLabourRoster.trade,
            employeeCode: constructionLabourRoster.employeeCode,
          })
          .from(constructionLabourRoster)
          .where(
            and(
              eq(constructionLabourRoster.orgId, ctx.orgId),
              eq(constructionLabourRoster.projectId, projectId),
              eq(constructionLabourRoster.isActive, true)
            )
          )
          .orderBy(asc(constructionLabourRoster.trade), asc(constructionLabourRoster.name))
        return rows
      })
    },
  }
}
