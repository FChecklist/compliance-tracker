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
import { constructionBoqLineItems, constructionBoqs, constructionLabourRoster, projects } from "@/lib/db/schema"
import { buildChain } from "@/lib/pipeline/derive-chain"
import { vocabularyKeyForParam, type PipelineErrorCode } from "@/lib/pipeline/error-codes"
import { functionSpec, requiredParamSatisfied, type CardSchema, type FunctionSpec } from "@/lib/pipeline/function-registry"
import { validate } from "@/lib/pipeline/validate"

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
  /**
   * R67 B-11 -- what the client sends back as this field's value on the next
   * chain-options request ("40 %", a BOQ line's record id, an ISO date).
   * Defaults to `id` when the two are the same thing.
   */
  value?: string
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
  /**
   * R67 B-11 -- the line's own total quantity, the ONLY honest denominator
   * for "2 nos done" -> a percent. 0 means the BOQ never carried one, which
   * is why the value level then offers percent chips alone.
   */
  quantity: number
}

export type BoqVersionRow = { id: string; version: number; title: string; status: string }
export type RosterRow = { id: string; name: string; trade: string | null; employeeCode: string | null }
export type ProjectRow = { id: string; name: string }

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
  /**
   * R67 B-11. The project level answers with the org's real projects instead
   * of the "pick a project in the top rail" hint B-03 could only give: when
   * `project` is the first unresolved field, refusing to list the choices IS
   * the refusal this item exists to remove.
   */
  projects(): Promise<ProjectRow[]>
}

// ── The catalogue of modules and their verbs ───────────────────────────────
// Deliberately small and closed: these are the chains R66 actually asked for,
// each ending in a real function or a real route. A verb with no backing
// executor and no route does not belong here -- it would be a dead end, and
// M24 forbids dead ends.
export type VerbDef = {
  id: string
  label: string
  /** the level this verb opens; "leaf" means the verb itself finishes the chain */
  opens: "boq-line" | "roster" | "boq-version" | "report-parameters" | "leaf"
  next: ChainOptionNext
  functionId?: string
  route?: string
}

export type ModuleDef = { id: string; label: string; verbs: VerbDef[] }

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

function verbOptions(moduleDef: ModuleDef): ChainOptionsResult {
  return {
    legend: CHAIN_OPTION_LEGENDS.verb,
    kind: "verb",
    options: moduleDef.verbs.map((v) => ({
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

  const moduleDef = MODULES.find((m) => m.id === moduleId)
  if (!moduleDef) return moduleOptions()

  if (!verbId) return verbOptions(moduleDef)

  const verb = moduleDef.verbs.find((v) => v.id === verbId)
  if (!verb) return verbOptions(moduleDef)

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

// ═══════════════════════════════════════════════════════════════════════════
// R67 B-11 -- THE ASK-DON'T-REFUSE CONTRACT.
//
// B-03 answers "what are the choices at this level?". This answers the
// question band 2 actually has to ask on every keystroke: "given the segments
// the user has picked and the values they have already supplied, WHICH FIELD
// IS STILL MISSING, what are its choices, and can I show the confirmation
// card yet?" -- { level, missing:[field], options, done }.
//
// The three rules that keep it from becoming a second rule set:
//   1. WHAT IS REQUIRED comes from function-registry.ts's requiredParams and
//      is judged by requiredParamSatisfied() -- the same predicate validate()
//      and the executor's server-side re-check use. Nothing here re-states
//      which parameters a function needs.
//   2. THE LAST WORD IS validate()'s. Once every field looks answered, the
//      assembled params go through the real validate() before `done` is
//      allowed to be true, so a BOQ line that is not in this project's BOQ,
//      or a percent outside 0..100, comes back as a level rather than as a
//      confirmation card that would fail on submit.
//   3. THE CHAIN IS DERIVED, NEVER COMPOSED HERE -- derive-chain.ts's
//      buildChain() renders it from the function id, exactly as
//      run-submission.ts does, so the words in band 2 and the words in Task
//      Master cannot drift.
//
// FIELD ORDER IS PROJECT -> RECORD -> VALUE, and it falls out of the
// structure rather than out of a table: the project gate runs first because
// no record level can be read without one, the verb's own record level runs
// second because that is what the verb opens, and the spec's remaining
// parameters run last in their declared order.
//
// ONE READ PER REQUEST still holds: the project gate returns before any
// record read, and a level reads only its own collection.

/** The D-03 field vocabulary a `missing` entry may name. */
export type ChainFieldKey = "project" | "boqLine" | "boqVersion" | "value" | "date" | "worker" | "material" | "task"

/**
 * A level names a field from the vocabulary above, one of the two segment
 * levels, the confirmation card, or -- for a purely TYPED field with nothing
 * to pick -- that field's own single lower-case word. Never a camelCase
 * parameter name: vocabularyKeyForParam() degrades anything carrying a
 * capital to "value" before it can get here.
 */
export type ChainLevelKey = ChainFieldKey | "module" | "verb" | "confirm" | "title" | "name" | "category"

export type ChainLevelOption = ChainOption & {
  /** which field (or segment level) this option answers. */
  kind: ChainLevelKey
  /** what the client sends back as that field's value on the next request. */
  value?: string
}

export type ChainLevelResult = {
  /** The field (or segment level) this answer is about. */
  level: ChainLevelKey
  /** The question, as a server-owned human sentence. */
  legend: string
  /**
   * The first unresolved field, in the D-03 vocabulary -- never a camelCase
   * parameter name. Empty exactly when `done` is true.
   */
  missing: ChainLevelKey[]
  options: ChainLevelOption[]
  /** true when everything is resolved and `card` is the confirmation schema. */
  done: boolean
  /** the level takes several picks at once (attendance). */
  multi?: boolean
  /** the user may type instead of picking (a value, a title). */
  allowsFreeText?: boolean
  /** values already filled in, so the level opens answered. */
  defaults?: Record<string, unknown>
  /** derive-chain's rendering of the segments so far, e.g. "Work Progress > New entry". */
  chain?: string
  functionId?: string
  /** the params as resolved so far -- what POST tasks receives on confirm. */
  params?: Record<string, unknown>
  /** present exactly when done and the leaf is a card. */
  card?: CardSchema
  /** the route a COMMAND/navigation leaf opens, present when done. */
  route?: string
  /** set when validate() refused the values supplied; the client's dictionary owns the sentence. */
  code?: PipelineErrorCode
}

export const CHAIN_LEVEL_LEGENDS = {
  project: "Which project?",
  value: "How much is done?",
  date: "Which date?",
  confirmCard: "Ready to save?",
  confirmAsk: "Ready to answer?",
  confirmRun: "Ready to run?",
  confirmRoute: "Ready to open?",
  freeText: "Type it",
} as const

/**
 * The value chips. A CLOSED, deliberately short list of input affordances --
 * not data: the quantity steps are the small counts a day's work is recorded
 * in (capped by the line's own quantity, so a chip can never over-record),
 * and the percent steps are the quarters plus the 40 % R-317 names. Typing a
 * value is always allowed beside them.
 */
export const VALUE_QUANTITY_STEPS: readonly number[] = [1, 2, 5, 10]
export const VALUE_PERCENT_STEPS: readonly number[] = [25, 40, 50, 75, 100]

/**
 * "2 nos" | "40 %" | "40" -> the params that answer them. A BARE NUMBER is a
 * percent, because percent is what record_work_progress's own required
 * parameter is; a number with any other suffix is a quantity in that unit,
 * which executeRecordWorkProgress converts against the line's total.
 */
export function parseValueInput(raw: string): { percent: number } | { quantityDone: number } | null {
  const text = raw.trim()
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z%.]*)$/.exec(text)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const suffix = match[2].trim()
  if (suffix.length === 0 || suffix === "%") return { percent: amount }
  return { quantityDone: amount }
}

// ── Segment matching ───────────────────────────────────────────────────────
// The composer sends what the user picked ("work-progress", "record"); the
// catalogue above is keyed by its own ids ("work_progress",
// "record_progress"). Normalise, then alias, then allow a verb to be named by
// either half of its id -- so "record", "record_progress" and "progress" all
// reach the same verb and no spelling of a real chain is a dead end.
function normaliseSegment(segment: string): string {
  return segment.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

const MODULE_ALIASES: Readonly<Record<string, string>> = {
  progress: "work_progress",
  work: "work_progress",
  labour: "manpower",
  attendance: "manpower",
  workers: "manpower",
  boq: "scope",
  report: "reports",
  budgets: "budget",
}

const VERB_ALIASES: Readonly<Record<string, string>> = {
  record: "record_progress",
  mark: "mark_attendance",
  attendance: "mark_attendance",
  revision: "new_revision",
  revise: "new_revision",
  wpr: "work_progress_report",
}

export function matchSegments(segments: readonly string[]): { moduleDef?: ModuleDef; verb?: VerbDef } {
  const [rawModule, rawVerb] = segments.map(normaliseSegment)
  if (!rawModule) return {}
  const moduleId = MODULE_ALIASES[rawModule] ?? rawModule
  const moduleDef = MODULES.find((m) => m.id === moduleId)
  if (!moduleDef || !rawVerb) return { moduleDef }
  const verbId = VERB_ALIASES[rawVerb] ?? rawVerb
  const verb =
    moduleDef.verbs.find((v) => v.id === verbId) ??
    moduleDef.verbs.find((v) => v.id.startsWith(`${rawVerb}_`) || v.id.endsWith(`_${rawVerb}`))
  return { moduleDef, verb }
}

/** Which field the verb's own record level fills. */
const FIELD_BY_OPENS: Readonly<Record<VerbDef["opens"], ChainFieldKey | null>> = {
  "boq-line": "boqLine",
  roster: "worker",
  "boq-version": "boqVersion",
  // The report's period IS a date range, so it asks in the date vocabulary
  // rather than inventing a ninth key the client dictionary cannot render.
  "report-parameters": "date",
  leaf: null,
}

/** The parameter each vocabulary key writes into a submission's params. */
const PARAM_BY_FIELD: Readonly<Record<ChainFieldKey, string>> = {
  project: "projectId",
  boqLine: "boqLineItemId",
  boqVersion: "boqId",
  value: "percent",
  date: "date",
  worker: "rosterId",
  material: "itemId",
  task: "issueId",
}

export type ChainLevelInput = {
  /** the segments picked so far, e.g. ["work-progress", "record"]. */
  segments: readonly string[]
  /** the project the top rail already has, used when `resolved.project` is absent. */
  projectId: string | null
  /** the fields the user has already answered, in the D-03 vocabulary. */
  resolved: Readonly<Partial<Record<ChainFieldKey, string>>>
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)
}

function withLevel(
  level: ChainLevelKey,
  missing: ChainLevelKey[],
  base: ChainOptionsResult,
  extra: Partial<ChainLevelResult> = {}
): ChainLevelResult {
  return {
    level,
    legend: base.legend,
    missing,
    options: base.options.map((o) => ({ ...o, kind: level, value: o.value ?? o.id })),
    done: false,
    ...(base.multi ? { multi: true } : {}),
    ...(base.defaults ? { defaults: base.defaults } : {}),
    ...extra,
  }
}

/** The vocabulary key a function's required parameter asks for. */
function fieldForRequired(required: FunctionSpec["requiredParams"][number]): ChainLevelKey {
  return (required.field ?? vocabularyKeyForParam(required.name)) as ChainLevelKey
}

/**
 * "How much is done?" -- quantity chips in the line's own unit beside percent
 * chips. Both are real answers: executeRecordWorkProgress converts a quantity
 * against the line's total, so neither chip is a dead end.
 */
function valueOptions(line: BoqLineRow | null): ChainOptionsResult {
  const options: ChainOption[] = []
  if (line && line.unit && Number.isFinite(line.quantity) && line.quantity > 0) {
    for (const step of VALUE_QUANTITY_STEPS) {
      if (step > line.quantity) continue
      options.push({
        id: `qty_${step}`,
        label: `${step} ${line.unit}`,
        group: "Quantity",
        isLeaf: true,
        next: "card",
        value: `${step} ${line.unit}`,
      })
    }
  }
  for (const step of VALUE_PERCENT_STEPS) {
    options.push({
      id: `pct_${step}`,
      label: `${step} %`,
      group: "Percent",
      isLeaf: true,
      next: "card",
      value: `${step} %`,
    })
  }
  return { legend: CHAIN_LEVEL_LEGENDS.value, kind: "parameter", options }
}

/** "Which date?" -- the two days a site entry is ever back-dated to. */
function dateOptions(): ChainOptionsResult {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  return {
    legend: CHAIN_LEVEL_LEGENDS.date,
    kind: "parameter",
    options: [
      { id: iso(today), label: "Today", isLeaf: true, next: "card", selected: true, value: iso(today) },
      { id: iso(yesterday), label: "Yesterday", isLeaf: true, next: "card", value: iso(yesterday) },
    ],
    defaults: { date: iso(today) },
  }
}

function projectOptions(rows: ProjectRow[]): ChainOptionsResult {
  if (rows.length === 0) {
    return {
      legend: CHAIN_LEVEL_LEGENDS.project,
      kind: "record",
      options: [
        {
          id: "new_project",
          label: "Create a project",
          isLeaf: false,
          next: "route",
          route: "/projects/new",
          unavailableReason: "This account has no projects yet",
        },
      ],
    }
  }
  return {
    legend: CHAIN_LEVEL_LEGENDS.project,
    kind: "record",
    options: rows.map((p) => ({ id: p.id, label: p.name, isLeaf: false, next: "card" as const, value: p.id })),
  }
}

function confirmLegend(next: ChainOptionNext): string {
  switch (next) {
    case "ask":
      return CHAIN_LEVEL_LEGENDS.confirmAsk
    case "run":
      return CHAIN_LEVEL_LEGENDS.confirmRun
    case "route":
      return CHAIN_LEVEL_LEGENDS.confirmRoute
    default:
      return CHAIN_LEVEL_LEGENDS.confirmCard
  }
}

/**
 * R67 B-11 -- THE LEVEL RESOLVER.
 *
 * Read-only, at most ONE repo call, and PURE apart from that call. Returns
 * the first unresolved field with its real choices, or `done` with the
 * confirmation card schema and the params POST /api/v1/projexa/tasks will
 * receive -- which that route re-validates for permission and existence
 * regardless, because an option list is a hint and never an authorisation.
 */
export async function resolveChainLevel(input: ChainLevelInput, repo: ChainOptionsRepo): Promise<ChainLevelResult> {
  const { moduleDef, verb } = matchSegments(input.segments)
  if (!moduleDef) return withLevel("module", ["module"], moduleOptions())
  if (!verb) return withLevel("verb", ["verb"], verbOptions(moduleDef))

  const spec = verb.functionId ? functionSpec(verb.functionId) : undefined
  const projectId = !blank(input.resolved.project) ? String(input.resolved.project) : input.projectId
  const needsAProject = spec ? spec.requiresProject : verb.opens !== "leaf"

  // ---- FIELD 1: the project ----------------------------------------------
  if (needsAProject && blank(projectId)) {
    return withLevel("project", ["project"], projectOptions(await repo.projects()))
  }

  // ---- the ONE read this level needs -------------------------------------
  const recordField = FIELD_BY_OPENS[verb.opens]
  const boq = verb.opens === "boq-line" && projectId ? await repo.latestBoqLines(projectId) : null
  const pickedLine =
    boq && !blank(input.resolved.boqLine) ? (boq.lines.find((l) => l.id === input.resolved.boqLine) ?? null) : null

  // ---- the params assembled from what the user has answered --------------
  const params: Record<string, unknown> = {}
  if (projectId) params.projectId = projectId
  for (const [key, raw] of Object.entries(input.resolved)) {
    if (blank(raw) || key === "project") continue
    const field = key as ChainFieldKey
    if (field === "value") {
      const parsed = parseValueInput(String(raw))
      if (parsed) Object.assign(params, parsed)
      continue
    }
    params[PARAM_BY_FIELD[field]] = String(raw)
  }
  // The chips address a BOQ line by record id; carrying its code too lets the
  // chain and the receipt line name it the way the BOQ does.
  if (pickedLine?.itemCode) params.itemCode = pickedLine.itemCode

  // ---- FIELD 2: whatever the verb itself opens ---------------------------
  if (recordField && blank(input.resolved[recordField])) {
    switch (verb.opens) {
      case "boq-line":
        return withLevel(recordField, [recordField], await boqLineLevel(boq, verb, projectId!))
      case "roster":
        return withLevel(recordField, [recordField], await rosterOptions(projectId!, verb, repo))
      case "boq-version":
        return withLevel(recordField, [recordField], await boqVersionOptions(projectId!, repo))
      case "report-parameters":
        return withLevel(recordField, [recordField], reportParameterOptions(projectId ?? null))
      default:
        break
    }
  }

  // A picked BOQ line that is not in this project's BOQ is not a resolved
  // field at all -- ask again, with the code the client's dictionary renders
  // as "There is no line ... - pick a line".
  if (verb.opens === "boq-line" && !blank(input.resolved.boqLine) && !pickedLine) {
    return {
      ...withLevel("boqLine", ["boqLine"], await boqLineLevel(boq, verb, projectId!)),
      code: "BOQ_LINE_NOT_FOUND",
    }
  }

  // ---- FIELD 3..n: the function's own remaining required parameters ------
  if (spec) {
    for (const required of spec.requiredParams) {
      if (required.name === "projectId") continue
      if (requiredParamSatisfied(required, params)) continue
      const field = fieldForRequired(required)
      if (field === "value") {
        return withLevel("value", ["value"], valueOptions(pickedLine), { allowsFreeText: true })
      }
      if (field === "date") {
        return withLevel("date", ["date"], dateOptions())
      }
      if (field === "worker") {
        return withLevel("worker", ["worker"], await rosterOptions(projectId!, verb, repo))
      }
      if (field === "boqVersion") {
        return withLevel("boqVersion", ["boqVersion"], await boqVersionOptions(projectId!, repo))
      }
      // A typed field (a title, a name, a link): there is nothing to pick, so
      // the level says so honestly rather than returning an empty list the
      // client would render as "no options".
      return withLevel(field, [field], { legend: `${required.label}?`, kind: "parameter", options: [] }, { allowsFreeText: true })
    }

    // ---- rule 2: validate() has the last word --------------------------
    const verdict = validate(
      { functionId: spec.functionId, params },
      {
        candidateFunctionIds: [spec.functionId],
        // The ids this request's own read proved exist in this project's BOQ.
        boqLineItemIds: new Set((boq?.lines ?? []).map((l) => l.id)),
        // chain-options is a READ endpoint whose route already applied the
        // member/read gate, and every leaf is re-authorised by POST
        // /api/v1/projexa/tasks on submit -- so permission is deliberately
        // not re-decided here from a set this service cannot see.
        userPermittedFunctionIds: new Set([spec.functionId]),
        // Reachability the read itself proved: the repo runs org-scoped
        // inside withTenantContext, so rows coming back for this project are
        // the proof that the org may reach it.
        reachableProjectIds: projectId ? new Set([projectId]) : new Set(),
        submissionProjectId: projectId,
        boqVersion: boq ? `v${boq.version}` : null,
      }
    )
    if (!verdict.valid) {
      const field = (verdict.missing[0] ? vocabularyKeyForParam(verdict.missing[0]) : "value") as ChainLevelKey
      const level =
        field === "boqLine"
          ? withLevel("boqLine", ["boqLine"], await boqLineLevel(boq, verb, projectId!))
          : field === "value"
            ? withLevel("value", ["value"], valueOptions(pickedLine), { allowsFreeText: true })
            : withLevel(field, [field], { legend: CHAIN_LEVEL_LEGENDS.freeText, kind: "parameter", options: [] }, { allowsFreeText: true })
      return { ...level, code: verdict.code }
    }
  }

  // ---- done: nothing is missing -----------------------------------------
  const route = doneRoute(verb, input.resolved, projectId ?? null)
  const card = spec?.card
  const chain = spec
    ? buildChain({ mode: "projects", rootLabel: null, functionId: spec.functionId, params, screen: null }).steps.join(" > ")
    : `${moduleDef.label} > ${verb.label}`
  return {
    level: "confirm",
    legend: confirmLegend(verb.next),
    missing: [],
    done: true,
    options: [
      {
        id: "confirm",
        label: card?.primaryLabel ?? verb.label,
        kind: "confirm",
        isLeaf: true,
        next: verb.next,
        functionId: verb.functionId,
        params,
        route,
        schema: card,
      },
    ],
    chain,
    functionId: verb.functionId,
    params,
    ...(card ? { card } : {}),
    ...(route ? { route } : {}),
  }
}

/** The BOQ-line level built from a read this request has already done. */
async function boqLineLevel(
  boq: { boqId: string; version: number; lines: BoqLineRow[] } | null,
  verb: VerbDef,
  projectId: string
): Promise<ChainOptionsResult> {
  // Reuses B-03's own builder by handing it the rows already in hand -- one
  // read per request, and exactly one place that decides what a BOQ-line
  // option looks like.
  return boqLineOptions(projectId, verb, {
    latestBoqLines: async () => boq,
    boqVersions: async () => [],
    roster: async () => [],
    projects: async () => [],
  })
}

/** Where a finished navigation/command chain actually lands. */
function doneRoute(
  verb: VerbDef,
  resolved: Readonly<Partial<Record<ChainFieldKey, string>>>,
  projectId: string | null
): string | undefined {
  if (verb.opens === "boq-version" && resolved.boqVersion) return `/scope/${resolved.boqVersion}/revise`
  if (verb.opens === "report-parameters") {
    const chosen = reportParameterOptions(projectId).options.find((o) => o.id === resolved.date)
    if (chosen?.route) return chosen.route
  }
  return verb.route
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
            // R67 B-11: numeric, so drizzle hands it back as a string.
            quantity: constructionBoqLineItems.quantity,
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
            quantity: Number(r.quantity ?? 0),
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

    // R67 B-11. Bounded on purpose: a level is a pick-list, and an org with
    // more projects than this needs the project screen's own search, not a
    // 500-row chip strip.
    async projects() {
      return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
        const rows = await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(eq(projects.orgId, ctx.orgId), eq(projects.isActive, true)))
          .orderBy(asc(projects.name))
          .limit(50)
        return rows
      })
    },
  }
}
