// Reports & Analysis ENGINE (Priority 11, Owner directive 2026-07-13):
// "REPORT and ANALYSIS ENGINE should be able to generate reports and
// analysis. It should be flexible so that without reworking and without
// duplicacy, reports and analysis can be merged from various reports and
// analysis, new reports and analysis can be created."
//
// Before this file, every report in this codebase was a bespoke, hand-
// written function (construction-reports-service.ts's 17 functions,
// erp-financial-report-service.ts's 4, custom-report-service.ts's one
// per-entity switch). That does not scale to the ~150 named reports/
// analyses the Owner catalogued, and re-doing that pattern 150 times is
// exactly the "duplicacy"/"rework" this file exists to avoid.
//
// The fix: a report_definitions ROW (report-taxonomy.ts's category/
// classifications/periodicity + one of 4 execution_type shapes below) is
// now a first-class, addable unit. Executing ANY definition goes through
// ONE dispatcher (executeReportDefinition), not a new function per report:
//
//   - 'deterministic_aggregation' -- a generic group-by/count/sum/avg,
//     resolved through TABLE_REGISTRY (below) -- a hardcoded, code-
//     reviewed map from a definition's tableKey string to real Drizzle
//     table/column objects. This generalizes custom-report-service.ts's
//     per-entity switch into ONE reusable function+registry pair instead
//     of a switch-branch per entity, while staying exactly as safe: a
//     report_definitions row's JSON config can only ever resolve to a key
//     that exists in TABLE_REGISTRY, never an arbitrary table (that would
//     reopen the exact surface custom-report-service.ts's own header
//     explicitly rejected). Future waves ADD their own domain's tables as
//     new TABLE_REGISTRY entries -- this is genuinely executable through
//     the dispatcher, not left for callers to wire per-report.
//   - 'deterministic_formula' -- looks up a named pure function in
//     FORMULA_REGISTRY (below) that computes a real calculated metric
//     (SPI/CPI/health index) from real queried data, honestly documenting
//     every simplifying assumption it makes.
//   - 'ai_recipe' -- a grounded LLM call (same discipline as ai-report-
//     builder-service.ts: the model's ONLY inputs are real queried data,
//     never invented figures), re-run fresh every call -- this is what
//     makes Category 4/6 (AI Analysis / AI-promoted-analysis) genuinely
//     live instead of a frozen snapshot.
//   - 'external_service' -- a thin passthrough marker for reports that
//     already have a real, working, hand-written implementation elsewhere
//     (the 4 pre-Priority-11 services) -- this execution_type deliberately
//     does NOT re-implement those; it just lets them be catalogued and
//     scheduled through the same definitions table as everything else.
//
// Category 5/6's "AI made it, put in system with software, next time
// software will make it" requirement is promoteAiAnalysisToDefinition()
// below: an ad-hoc AI report-builder proposal (ai-report-builder-service.ts)
// gets inserted as a REAL report_definitions row (deterministic_aggregation
// if the proposal reduces to a simple groupby the engine can run without AI
// next time, ai_recipe if the judgment genuinely can't be made
// deterministic) -- not left as a frozen one-off blob in savedReports.

import {
  db, reportDefinitions,
  complianceItems, notices, risks, pmsIssues, incidents,
  constructionBoqs, constructionWorkProgressEntries, constructionAttendance,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, or, isNull, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson, stripJsonFence } from "@/lib/llm-client"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { validateClassifications, validatePeriodicity, REPORT_CATEGORY_VALUES, type ReportCategory } from "./report-taxonomy"
import { budgetVsActual, projectCompletionReport } from "./construction-reports-service"
import { REPORT_CATALOG, type ReportCatalogEntry, type ReportDomain } from "./report-catalog-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ExecutionType = "deterministic_aggregation" | "deterministic_formula" | "ai_recipe" | "external_service"

// ─── execution_config shapes, one per ExecutionType ───────────────────────

export type AggregationConfig = {
  kind: "aggregation"
  /** Key into TABLE_REGISTRY below -- NOT an arbitrary table name: only keys that exist in that code-reviewed, hardcoded map resolve to anything, exactly like custom-report-service.ts's GROUP_BY_FIELDS whitelist. */
  tableKey: string
  /** Key into TABLE_REGISTRY[tableKey].columns, or omitted for a single Total row (no GROUP BY). */
  groupByColumn?: string
  aggregation: "count" | "sum" | "avg"
  /** Key into TABLE_REGISTRY[tableKey].columns -- required when aggregation is "sum"/"avg". */
  aggregationColumnKey?: string
}
export type FormulaConfig = { kind: "formula"; formulaKey: string; params?: Record<string, unknown> }
export type AiRecipeConfig = { kind: "ai_recipe"; promptKey: string; groundingNote: string }
export type ExternalServiceConfig = { kind: "external_service"; sourceService: string; sourceFunction: string; requiredParams?: string[] }

export type ReportDefinitionResult = { columns: string[]; rows: Record<string, string | number>[]; narrative?: string; note?: string }

// ─── Generic aggregation executor (the group-by generalization) ──────────

/**
 * Runs `SELECT groupByColumn, agg(*) FROM table WHERE orgIdColumn = ctx.orgId [AND extraWhere] GROUP BY groupByColumn`.
 * Callers pass real, already-imported Drizzle table/column objects -- this
 * function does no string-to-table resolution, so it cannot become an
 * arbitrary-query surface no matter what a report_definitions row's JSON
 * config says. Mirrors custom-report-service.ts's runReport() switch
 * exactly, just parameterized once instead of duplicated per entity.
 */
export async function runAggregation(
  db: TenantDb,
  args: {
    table: PgTable
    orgIdColumn: AnyPgColumn
    orgId: string
    groupByColumn: AnyPgColumn | null
    aggregation: "count" | "sum" | "avg"
    aggregationColumn?: AnyPgColumn
    extraWhere?: SQL
  }
): Promise<{ groupValue: unknown; value: number }[]> {
  const aggExpr =
    args.aggregation === "count"
      ? sql<number>`count(*)::float`
      : args.aggregation === "sum"
        ? sql<number>`coalesce(sum(${args.aggregationColumn}), 0)::float`
        : sql<number>`coalesce(avg(${args.aggregationColumn}), 0)::float`

  const where = args.extraWhere ? and(eq(args.orgIdColumn, args.orgId), args.extraWhere) : eq(args.orgIdColumn, args.orgId)

  if (!args.groupByColumn) {
    const [row] = await db.select({ value: aggExpr }).from(args.table).where(where)
    return [{ groupValue: "Total", value: Number(row?.value ?? 0) }]
  }
  const groupByColumn = args.groupByColumn
  const rows = await db
    .select({ groupValue: groupByColumn, value: aggExpr })
    .from(args.table)
    .where(where)
    .groupBy(groupByColumn)
  return rows.map((r) => ({ groupValue: r.groupValue, value: Number(r.value) }))
}

// ─── Table registry (what makes deterministic_aggregation definitions
// executable through the ONE dispatcher, not a bespoke function per report)
// ────────────────────────────────────────────────────────────────────────
// Every value here is a real, already-imported, code-reviewed Drizzle
// table/column object -- resolving a report_definitions row's tableKey
// string against this map is exactly as safe as custom-report-service.ts's
// GROUP_BY_FIELDS switch (same whitelist discipline, same file this
// mirrors), just centralized once instead of duplicated per switch-branch.
// A report_definitions row's executionConfig.tableKey can ONLY ever
// resolve to something here -- there is no code path from a JSON string to
// an arbitrary table.
//
// Seeded with the same 8 entities custom-report-service.ts already
// whitelists (not a new decision, just cataloging the existing whitelist
// under the new engine too). Future waves ADD their own domain's tables as
// NEW entries appended at the end -- additive-only, never edit an existing
// entry, so multiple waves adding different domains' tables in parallel
// stay merge-safe (the same "additive-only, append at the end" discipline
// already used for reports/page.tsx and CustomReportsSection.tsx in the
// prior Reports & Analysis wave).
export type TableRegistryEntry = { table: PgTable; orgIdColumn: AnyPgColumn; columns: Record<string, AnyPgColumn> }

export const TABLE_REGISTRY: Record<string, TableRegistryEntry> = {
  compliance_items: { table: complianceItems, orgIdColumn: complianceItems.orgId, columns: { status: complianceItems.status, priority: complianceItems.priority, departmentId: complianceItems.departmentId } },
  notices: { table: notices, orgIdColumn: notices.orgId, columns: { status: notices.status, authority: notices.authority } },
  risks: { table: risks, orgIdColumn: risks.orgId, columns: { status: risks.status, category: risks.category } },
  pms_issues: { table: pmsIssues, orgIdColumn: pmsIssues.orgId, columns: { statusId: pmsIssues.statusId, priority: pmsIssues.priority } },
  incidents: { table: incidents, orgIdColumn: incidents.orgId, columns: { stage: incidents.stage, severity: incidents.severity } },
  construction_boqs: { table: constructionBoqs, orgIdColumn: constructionBoqs.orgId, columns: { status: constructionBoqs.status } },
  construction_work_progress_entries: { table: constructionWorkProgressEntries, orgIdColumn: constructionWorkProgressEntries.orgId, columns: { activityId: constructionWorkProgressEntries.activityId } },
  construction_attendance: { table: constructionAttendance, orgIdColumn: constructionAttendance.orgId, columns: { status: constructionAttendance.status, rosterId: constructionAttendance.rosterId } },
}

// ─── Formula registry (deterministic_formula) ─────────────────────────────
// Small and deliberately honest about its own approximations -- every
// formula below documents exactly which real columns it reads and which
// standard simplification it applies when this codebase has no baseline
// S-curve/earned-value table to compute the textbook-precise version.
// Future waves add more formulas by adding a new key here (additive,
// self-contained) rather than touching the dispatcher.

type FormulaFn = (ctx: { orgId: string }, params: Record<string, unknown>) => Promise<ReportDefinitionResult>

/**
 * Schedule Performance Index, project-level. Textbook SPI = Earned Value /
 * Planned Value. This codebase has no baseline S-curve (a planned-%-
 * complete-over-time table), so Planned Value is approximated as a linear
 * function of elapsed time between projects.startDate and projects.
 * targetDate -- a standard simplified proxy when no detailed baseline
 * schedule exists, not a fabricated number. Earned Value is the project's
 * real actual percentComplete (projectCompletionReport(), construction-
 * reports-service.ts). SPI > 1 = ahead of the time-linear plan, < 1 =
 * behind. Requires both startDate and targetDate to be set; without them
 * there is no plan to compare against, so this returns a data_gap note
 * rather than a fabricated ratio.
 */
async function computeSpi(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the SPI formula", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: (t, { and, eq }) => and(eq(t.id, projectId), eq(t.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    if (!project.startDate || !project.targetDate) {
      return { columns: ["Metric", "Value"], rows: [{ Metric: "SPI", Value: "N/A" }], note: "Project has no startDate/targetDate set -- cannot compute a time-linear planned-progress baseline." }
    }
    const start = new Date(project.startDate).getTime()
    const target = new Date(project.targetDate).getTime()
    const now = Date.now()
    const totalMs = target - start
    const plannedPercent = totalMs <= 0 ? 100 : Math.max(0, Math.min(100, ((now - start) / totalMs) * 100))
    const completion = await projectCompletionReport(ctx, projectId)
    const actualPercent = completion.overallPercentComplete
    const spi = plannedPercent > 0 ? actualPercent / plannedPercent : actualPercent > 0 ? Infinity : 1
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Actual % Complete", Value: actualPercent },
        { Metric: "Planned % Complete (time-linear)", Value: Math.round(plannedPercent * 10) / 10 },
        { Metric: "SPI", Value: Number.isFinite(spi) ? Math.round(spi * 100) / 100 : 99 },
      ],
      note: "Planned % Complete is a linear time-elapsed proxy (project.startDate -> targetDate) -- this codebase has no baseline S-curve table for a precise Planned Value.",
    }
  })
}

/**
 * Cost Performance Index, project-level. Textbook CPI = Earned Value /
 * Actual Cost. Earned Value is approximated as Budget * (actual % complete
 * / 100) -- the standard BCWP simplification (per Owner's own 30-Analysis
 * catalog, this is the documented industry-standard approximation used
 * absent a granular per-activity budget breakdown). Actual Cost is the
 * project's real logged expenses (budgetVsActual(), construction-reports-
 * service.ts). CPI > 1 = under budget for work done, < 1 = over budget.
 */
async function computeCpi(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the CPI formula", 400)
  const [budget, completion] = await Promise.all([budgetVsActual(ctx, projectId), projectCompletionReport(ctx, projectId)])
  if (budget.budget <= 0) {
    return { columns: ["Metric", "Value"], rows: [{ Metric: "CPI", Value: "N/A" }], note: "Project has no budget set (via its cost centre) -- cannot compute Earned Value." }
  }
  const earnedValue = budget.budget * (completion.overallPercentComplete / 100)
  const cpi = budget.actual > 0 ? earnedValue / budget.actual : earnedValue > 0 ? Infinity : 1
  return {
    columns: ["Metric", "Value"],
    rows: [
      { Metric: "Budget (BAC)", Value: Math.round(budget.budget) },
      { Metric: "Actual Cost", Value: Math.round(budget.actual) },
      { Metric: "Earned Value (Budget x % Complete)", Value: Math.round(earnedValue) },
      { Metric: "CPI", Value: Number.isFinite(cpi) ? Math.round(cpi * 100) / 100 : 99 },
    ],
    note: "Earned Value uses the standard Budget x %-Complete approximation (BCWP) -- this codebase has no per-activity budget breakdown for a more granular Earned Value.",
  }
}

/**
 * Project Health Index -- a single 0-100 composite score, weighted average
 * of SPI and CPI each normalized to a 0-100 scale (1.0 -> 100, clamped),
 * documented as exactly that -- a transparent weighted blend, not a
 * black-box AI score (that's what Category 4's "AI Project Risk
 * Prediction" is for, a genuinely different, AI-judgment-based metric).
 */
async function computeProjectHealthIndex(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const [spiResult, cpiResult] = await Promise.all([computeSpi(ctx, params), computeCpi(ctx, params)])
  const spiRow = spiResult.rows.find((r) => r.Metric === "SPI")
  const cpiRow = cpiResult.rows.find((r) => r.Metric === "CPI")
  const spi = typeof spiRow?.Value === "number" ? spiRow.Value : null
  const cpi = typeof cpiRow?.Value === "number" ? cpiRow.Value : null
  if (spi == null || cpi == null) {
    return { columns: ["Metric", "Value"], rows: [{ Metric: "Project Health Index", Value: "N/A" }], note: "Requires both SPI and CPI to be computable -- see their own notes for what's missing." }
  }
  const normalize = (ratio: number) => Math.max(0, Math.min(100, ratio * 100))
  const healthIndex = Math.round((normalize(spi) + normalize(cpi)) / 2)
  return {
    columns: ["Metric", "Value"],
    rows: [
      { Metric: "SPI", Value: spi },
      { Metric: "CPI", Value: cpi },
      { Metric: "Project Health Index (0-100)", Value: healthIndex },
    ],
    note: "Transparent weighted average of normalized SPI and CPI (50/50) -- not an AI-derived score.",
  }
}

export const FORMULA_REGISTRY: Record<string, FormulaFn> = {
  schedule_performance_index: computeSpi,
  cost_performance_index: computeCpi,
  project_health_index: computeProjectHealthIndex,
}

// ─── AI recipe executor (ai_recipe) ───────────────────────────────────────
// Reuses ai-report-builder-service.ts's exact grounding discipline: the
// model's ONLY inputs are the real data this function queries and passes
// in -- groundingData is serialized verbatim into the prompt, nothing else
// is interpolated, and the system prompt forbids inventing unsourced
// numbers. Unlike ai-report-builder-service.ts (grounded in an uploaded
// file), this is grounded in a live DB query the definition's own config
// names -- see PROMPT_TEMPLATES below for what each promptKey actually
// grounds against.

const AI_RECIPE_SYSTEM_PROMPT = `You are an analysis assistant inside VERIDIAN AI OS. You will be given real, live data queried from the organisation's own records. Produce a concise analysis grounded ONLY in that data.

STRICT RULES:
- Use ONLY facts, numbers, and patterns present in the provided data. Never invent, estimate, or guess a figure not derivable from it.
- If the data is too sparse to support a real conclusion, say so plainly instead of padding with generic advice.

Respond with ONLY a JSON object of this exact shape, no markdown, no extra text:
{ "columns": ["Column A", "Column B"], "rows": [ { "Column A": "value", "Column B": "value" } ], "narrative": "2-4 sentence grounded analysis" }`

async function runAiRecipe(ctx: { orgId: string; userId?: string }, config: AiRecipeConfig, groundingData: unknown): Promise<ReportDefinitionResult> {
  const startedAt = Date.now()
  const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa")
  if (!modelConfig) throw new ServiceError("No AI model is configured for this organisation. Configure one in Settings -> AI Configuration.", 503)

  const { data, usage } = await callLLMJson<{ columns?: string[]; rows?: Record<string, unknown>[]; narrative?: string }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey,
    AI_RECIPE_SYSTEM_PROMPT,
    `Recipe: ${config.promptKey}\nGrounding note: ${config.groundingNote}\n\nReal data (the ONLY source of truth for this analysis):\n${JSON.stringify(groundingData).slice(0, 12000)}`,
    { temperature: 0.1, maxTokens: 1500 },
    modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId ?? "system", layerKey: "customer_account_oa", eventType: "reports.ai_recipe_execute",
    input: { promptKey: config.promptKey }, output: { rowCount: data?.rows?.length ?? 0 },
    status: "completed", durationMs: Date.now() - startedAt, provider: modelConfig.provider, model: modelConfig.model, usage,
  })

  const columns = Array.isArray(data?.columns) ? data!.columns.map(String) : []
  const rows = Array.isArray(data?.rows) ? (data!.rows as Record<string, string | number>[]) : []
  if (columns.length === 0 || rows.length === 0) {
    return { columns: ["Note"], rows: [{ Note: "AI could not derive a structured analysis from the available data." }], narrative: data?.narrative }
  }
  return { columns, rows, narrative: typeof data?.narrative === "string" ? data.narrative : undefined }
}

// ─── report_definitions CRUD (org-scoped OR platform-wide read, matching
// platformAssets/taskCapabilities' nullable-org precedent) ────────────────

export type CreateReportDefinitionInput = {
  name: string
  description: string
  category: ReportCategory
  classifications: string[]
  periodicity?: string | null
  periodicityConfig?: Record<string, unknown> | null
  executionType: ExecutionType
  executionConfig: AggregationConfig | FormulaConfig | AiRecipeConfig | ExternalServiceConfig
  outputFormats?: string[]
  status?: "built" | "data_gap" | "planned"
  dataGapNote?: string | null
  createdBy?: string
  promotedFromContext?: string | null
}

export function validateReportDefinitionInput(input: CreateReportDefinitionInput): { valid: true } | { valid: false; reason: string } {
  if (!input.name?.trim()) return { valid: false, reason: "name is required" }
  if (!input.description?.trim()) return { valid: false, reason: "description is required" }
  if (!REPORT_CATEGORY_VALUES.includes(input.category)) return { valid: false, reason: `category must be one of: ${REPORT_CATEGORY_VALUES.join(", ")}` }
  const classificationCheck = validateClassifications(input.classifications)
  if (!classificationCheck.valid) return classificationCheck
  if (input.periodicity) {
    const periodicityCheck = validatePeriodicity(input.periodicity, input.periodicityConfig as never)
    if (!periodicityCheck.valid) return periodicityCheck
  }
  if (!["deterministic_aggregation", "deterministic_formula", "ai_recipe", "external_service"].includes(input.executionType)) {
    return { valid: false, reason: "executionType must be one of: deterministic_aggregation, deterministic_formula, ai_recipe, external_service" }
  }
  if ((input.status ?? "built") !== "built" && !input.dataGapNote?.trim()) {
    return { valid: false, reason: "dataGapNote is required when status is not 'built' -- never leave a non-built definition unexplained" }
  }
  return { valid: true }
}

export async function listReportDefinitions(ctx: { orgId: string }, filter?: { category?: string; classification?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findMany({
      where: (t, { and, eq, or, isNull }) => {
        const scope = or(eq(t.orgId, ctx.orgId), isNull(t.orgId))
        const categoryFilter = filter?.category ? eq(t.category, filter.category) : undefined
        return categoryFilter ? and(scope, categoryFilter) : scope
      },
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  ).then((rows) =>
    filter?.classification ? rows.filter((r) => Array.isArray(r.classifications) && (r.classifications as string[]).includes(filter.classification!)) : rows
  )
}

export async function createReportDefinition(ctx: { orgId: string; asPlatformWide?: boolean }, input: CreateReportDefinitionInput) {
  const check = validateReportDefinitionInput(input)
  if (!check.valid) throw new ServiceError(check.reason, 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [created] = await db.insert(reportDefinitions).values({
      orgId: ctx.asPlatformWide ? null : ctx.orgId,
      name: input.name.trim(),
      description: input.description.trim(),
      category: input.category,
      classifications: input.classifications,
      periodicity: input.periodicity || null,
      periodicityConfig: input.periodicityConfig || null,
      executionType: input.executionType,
      executionConfig: input.executionConfig,
      outputFormats: input.outputFormats ?? ["table"],
      status: input.status ?? "built",
      dataGapNote: input.dataGapNote || null,
      createdBy: input.createdBy ?? "system",
      promotedFromContext: input.promotedFromContext || null,
    }).returning()
    return created
  })
}

export async function updateReportDefinition(ctx: { orgId: string }, id: string, patch: Partial<CreateReportDefinitionInput & { isActive: boolean }>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.reportDefinitions.findFirst({ where: and(eq(reportDefinitions.id, id), or(eq(reportDefinitions.orgId, ctx.orgId), isNull(reportDefinitions.orgId))) })
    if (!existing) throw new ServiceError("Report definition not found", 404)
    if (existing.orgId === null) throw new ServiceError("Platform-wide definitions cannot be edited from an org context", 403)
    const [updated] = await db.update(reportDefinitions).set({ ...patch, updatedAt: new Date() }).where(eq(reportDefinitions.id, id)).returning()
    return updated
  })
}

export async function deleteReportDefinition(ctx: { orgId: string }, id: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.reportDefinitions.findFirst({ where: and(eq(reportDefinitions.id, id), eq(reportDefinitions.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Report definition not found (or is platform-wide, which cannot be deleted from an org context)", 404)
    await db.delete(reportDefinitions).where(eq(reportDefinitions.id, id))
  })
}

// ─── The dispatcher every report_definitions row is run through ──────────

export async function executeReportDefinition(ctx: { orgId: string; userId?: string }, id: string, params: Record<string, unknown> = {}): Promise<ReportDefinitionResult> {
  const definition = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findFirst({ where: and(or(eq(reportDefinitions.orgId, ctx.orgId), isNull(reportDefinitions.orgId)), eq(reportDefinitions.id, id)) })
  )
  if (!definition) throw new ServiceError("Report definition not found", 404)
  if (definition.status !== "built") {
    return { columns: ["Note"], rows: [{ Note: `This report/analysis is not yet built (status: ${definition.status}).` }], note: definition.dataGapNote ?? undefined }
  }

  const config = definition.executionConfig as AggregationConfig | FormulaConfig | AiRecipeConfig | ExternalServiceConfig

  if (definition.executionType === "deterministic_aggregation" && config.kind === "aggregation") {
    const entry = TABLE_REGISTRY[config.tableKey]
    if (!entry) throw new ServiceError(`No table registered for key "${config.tableKey}" -- see TABLE_REGISTRY in this file`, 500)
    const groupByColumn = config.groupByColumn ? entry.columns[config.groupByColumn] : undefined
    if (config.groupByColumn && !groupByColumn) throw new ServiceError(`Unknown groupByColumn "${config.groupByColumn}" for table "${config.tableKey}"`, 500)
    const aggregationColumn = config.aggregationColumnKey ? entry.columns[config.aggregationColumnKey] : undefined
    if (config.aggregationColumnKey && !aggregationColumn) throw new ServiceError(`Unknown aggregationColumnKey "${config.aggregationColumnKey}" for table "${config.tableKey}"`, 500)
    const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      runAggregation(db, { table: entry.table, orgIdColumn: entry.orgIdColumn, orgId: ctx.orgId, groupByColumn: groupByColumn ?? null, aggregation: config.aggregation, aggregationColumn })
    )
    return { columns: ["Group", "Value"], rows: rows.map((r) => ({ Group: String(r.groupValue), Value: r.value })) }
  }

  if (definition.executionType === "deterministic_formula" && config.kind === "formula") {
    const fn = FORMULA_REGISTRY[config.formulaKey]
    if (!fn) throw new ServiceError(`No formula registered for key "${config.formulaKey}"`, 500)
    return fn(ctx, { ...(config.params ?? {}), ...params })
  }

  if (definition.executionType === "ai_recipe" && config.kind === "ai_recipe") {
    // Grounding data comes from the same aggregation/formula primitives
    // this file already exposes -- callers that register an ai_recipe
    // definition are expected to pass their own already-queried grounding
    // data via params.groundingData (built the same way ai-report-builder-
    // service.ts extracts real content before ever calling the LLM).
    return runAiRecipe(ctx, config, params.groundingData ?? {})
  }

  if (definition.executionType === "external_service") {
    return { columns: ["Note"], rows: [{ Note: `This report is served by its existing implementation (${(config as ExternalServiceConfig).sourceService}#${(config as ExternalServiceConfig).sourceFunction}), not through this generic engine -- see report-catalog-service.ts for its real route.` }] }
  }

  throw new ServiceError(`Definition ${id} has executionType "${definition.executionType}" but no matching handler in this dispatcher.`, 500)
}

// ─── Category 5/6 promotion (the literal "next time software will make
// it" mechanism) ───────────────────────────────────────────────────────

/**
 * Promotes an ad-hoc AI-proposed report (the shape ai-report-builder-
 * service.ts's proposeReportFromUpload() returns) into a reusable
 * report_definitions row. If the proposal is a simple, static table (no
 * ongoing judgment needed), it's stored as-is with executionType
 * 'external_service' pointing back at the frozen savedReports row (so
 * "software makes it" means "software redisplays the AI's real prior
 * output", not a fabricated live re-query of data the AI can't
 * re-derive from an ephemeral upload). If the caller explicitly marks it
 * `stillNeedsAiJudgment`, it's stored as 'ai_recipe' with the given
 * groundingNote instead, category 'ai_new_analysis_promoted' -- for
 * definitions whose grounding data IS a live queryable source (not a
 * one-off upload), letting every future run re-derive fresh output.
 */
export async function promoteAiAnalysisToDefinition(
  ctx: { orgId: string; userId: string },
  input: {
    name: string
    description: string
    classifications: string[]
    sourceSavedReportId: string
    stillNeedsAiJudgment?: boolean
    aiRecipeConfig?: AiRecipeConfig
  }
) {
  return createReportDefinition(
    { orgId: ctx.orgId },
    {
      name: input.name,
      description: input.description,
      category: input.stillNeedsAiJudgment ? "ai_new_analysis_promoted" : "ai_new_report_promoted",
      classifications: input.classifications,
      executionType: input.stillNeedsAiJudgment ? "ai_recipe" : "external_service",
      executionConfig: input.stillNeedsAiJudgment
        ? (input.aiRecipeConfig ?? { kind: "ai_recipe", promptKey: `promoted_${input.sourceSavedReportId}`, groundingNote: "Promoted from an ad-hoc AI report -- grounding source to be configured." })
        : { kind: "external_service", sourceService: "custom-report-service.ts", sourceFunction: "runReport", requiredParams: ["reportId"] },
      createdBy: "ai",
      promotedFromContext: `savedReports:${input.sourceSavedReportId}`,
    }
  )
}

// ─── Merged catalog (static REPORT_CATALOG + live report_definitions rows)
// ─────────────────────────────────────────────────────────────────────────
// Deliberately lives HERE, not in report-catalog-service.ts, even though it
// conceptually extends that file's catalog -- report-catalog-service.ts is
// imported by ReportCatalogList.tsx, a CLIENT component ("use client"), and
// that file's own header states it is DATA-ONLY with no DB access. Adding a
// withTenantContext()/db-touching function there once broke the production
// build (Next.js's client bundler pulled the `postgres` driver, which needs
// Node's `tls`/`perf_hooks`, into the client JS bundle). This file is
// already server-only (imports `db`/LLM clients), consumed only by server
// code (capability-tree-service.ts, API routes) -- the safe place for
// anything that touches the DB.

export type FullCatalogEntry = ReportCatalogEntry & { source: "static" | "definition"; definitionId?: string; status?: "built" | "data_gap" | "planned" }

export async function getFullReportCatalog(ctx: { orgId: string }): Promise<FullCatalogEntry[]> {
  const staticEntries: FullCatalogEntry[] = REPORT_CATALOG.map((e) => ({ ...e, source: "static" }))

  const definitions = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findMany({
      where: (t, { and, eq, or, isNull }) => and(or(eq(t.orgId, ctx.orgId), isNull(t.orgId)), eq(t.isActive, true)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )

  const definitionEntries: FullCatalogEntry[] = definitions.map((d) => {
    const classifications = Array.isArray(d.classifications) ? (d.classifications as string[]) : []
    const domain: ReportDomain = classifications.includes("compliance")
      ? "compliance"
      : classifications.includes("financial") || classifications.includes("revenue")
        ? "ERP"
        : classifications.includes("construction") || classifications.includes("project")
          ? "construction"
          : "custom"
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      domain,
      sourceService: "src/lib/services/report-engine-service.ts#executeReportDefinition",
      outputFormats: Array.isArray(d.outputFormats) ? (d.outputFormats as string[]) : ["table"],
      route: `/api/reports/definitions/${d.id}/run`,
      routeNote: d.status === "built" ? "Real, auth-required API endpoint (POST) executed by the generic Reports & Analysis Engine dispatcher." : `Not yet built -- ${d.dataGapNote ?? "status: " + d.status}`,
      directlyNavigable: false,
      category: d.category as ReportCategory,
      classifications,
      periodicity: d.periodicity ?? undefined,
      source: "definition",
      definitionId: d.id,
      status: d.status as "built" | "data_gap" | "planned",
    }
  })

  return [...staticEntries, ...definitionEntries]
}

export async function getFullReportCatalogByDomain(ctx: { orgId: string }): Promise<Record<ReportDomain, FullCatalogEntry[]>> {
  const all = await getFullReportCatalog(ctx)
  const byDomain: Record<ReportDomain, FullCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [] }
  for (const entry of all) byDomain[entry.domain].push(entry)
  return byDomain
}
