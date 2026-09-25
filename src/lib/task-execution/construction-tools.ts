// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Code
// Structure & Modularity): extracted from task-execution-engine.ts's
// dispatchTool() -- the Construction Intelligence (PROJEXA, Wave 128)
// slice of that function's if-chain, unchanged in behavior, just relocated
// + grouped by responsibility. See compliance-tools.ts's header for the
// full extraction rationale.
//
// REBASE NOTE (2026-08-31): the original extraction (written against a
// main predating R48's F089 fix) dropped the role-based financial-field
// redaction gate main had added inline for these 3 tools in the meantime
// -- that would have been a real regression of the F089/F059 budget-leak
// fix on this 4th surface. Fixed during rebase by adding the `role` param
// back and reproducing the exact same financialsAllowed gate
// task-execution-engine.ts had inline before this extraction (same
// ROLE_RANK check, same redaction shape on get_construction_project_
// dashboard, same "requires manager role or higher" throw on
// get_construction_budget_status/list_over_budget_projects).
//
// All read-only, matching dispatchTool()'s read-only-auto-dispatch
// contract. Each independently opens its own withTenantContext transaction
// via the service call (no shared `db` param needed here, unlike
// compliance-tools.ts/gst-tools.ts) -- same posture as the original inline
// implementation.
//
// CORRECTION (R75 Part 2, R-80 investigation, 2026-09-05): "no shared db
// param needed here" was wrong whenever this whole call chain is itself
// invoked from inside an ALREADY-OPEN withTenantContext transaction (e.g.
// POST /api/v1/projexa/assistant's codeReference dispatch path: the route
// opens one, then dispatchTool() -> dispatchConstructionTool() used to drop
// it and let get_construction_project_dashboard/list_delayed_activities/
// list_over_budget_projects each open a SECOND, nested one -- verified
// empirically: assertNotNested() throws in dev/test, silently opens a
// second pool connection in production. `db` is now threaded through for
// those 3 codeReferences (the ones that call getOrgDashboard[WithDb]/
// getProjectDashboard[s][WithDb]) via the new WithDb service variants.
// get_construction_kpi_status is ALSO now fixed (R75 Part 3): kpiReport()
// gained a kpiReportWithDb() sibling, same pattern as the 3 dashboard
// codeReferences above -- construction-reports-service.ts's own
// ensureConstructionEnabled() got a WithDb sibling too
// (ensureConstructionEnabledWithDb(), which itself calls the new
// requireConstructionEnabledWithDb() in construction-enablement-service.ts),
// deliberately bypassing that file's enablementMemo cache since reusing an
// already-open connection makes the memo's original purpose (avoiding a
// redundant transaction OPEN) moot for this specific call.
//
// get_construction_budget_status/generate_construction_progress_summary/
// detect_construction_budget_schedule_risk still call functions
// (budgetVsActual/generateProgressSummary/detectBudgetScheduleRisk, in
// construction-reports-service.ts/construction-ai-service.ts) that open
// their OWN transaction and were NOT given WithDb siblings in this pass --
// budgetVsActual additionally fans out via Promise.all (getProjectDashboard
// + getExpenseSummaryByHead concurrently) and detectBudgetScheduleRisk
// depends on BOTH getProjectDashboard AND budgetVsActual via ITS OWN
// Promise.all, a materially larger and riskier surface than kpiReport's
// single clean withTenantContext call was. They carry the same class of
// bug, not yet fixed. Not silently claimed
// fixed; flagged honestly (see this file's own git history / R-80's
// sumeet_requirements next_action for the full accounting).

import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
import type { TenantDb } from "@/lib/db/tenant-scoped"

export const CONSTRUCTION_TOOL_CODES = new Set([
  "get_construction_project_dashboard",
  "list_delayed_activities",
  "get_construction_budget_status",
  "list_over_budget_projects",
  "get_construction_kpi_status",
  "generate_construction_progress_summary",
  "detect_construction_budget_schedule_risk",
])

/**
 * PROJEXA-BUILD-001 U-01 (2026-09-25): the one rule for "may this acting
 * person see construction budget/margin/cost figures". True only when the
 * role is KNOWN and ranks manager or above. It used to be
 * `role ? rank >= manager : true` inline below, so every caller that did not
 * thread a role through (the personal AI link, the pipeline's dispatch reads,
 * an API-key call to the PROJEXA assistant) got the figures unredacted: an
 * unknown role was read as "show everything". Unknown now reads as "redact".
 * Exported so executor.ts's own dashboard redaction applies the same rule
 * rather than a second copy of it.
 */
export function financialsAllowedForRole(role?: string | null): boolean {
  if (!role) return false
  return (ROLE_RANK[role as UserRole] ?? 0) >= ROLE_RANK.manager
}

/**
 * U-01: the money fields a project dashboard read through these tools
 * withholds from a caller financialsAllowedForRole() refuses -- the same list
 * api/v1/projexa/dashboard/[projectId]/route.ts withholds. The two inline
 * copies this replaces (here and executor.ts) both lacked ledgerBudget (the
 * ERP ledger budget) and progressByBoqValuePct (percentByValue under its UI
 * name), so a member still got both.
 */
// The money fields a redacted dashboard reports as null. Named here so the
// return type below can OMIT them from T before adding the null versions: with
// no explicit type, spreading a generic T and then setting `budget: null`
// makes TypeScript intersect `budget: number` with `budget: null`, which
// collapses to never, and a caller cannot spread a never (TS2698).
type RedactedDashboardMoney = {
  budget: null; ledgerBudget: null; revenue: null; expenses: null
  projectValue: null; earnedValue: null; percentByValue: null; contractValue: null
  progressByBoqValuePct: null
}

export function redactProjectDashboardFinancials<T extends object>(
  dashboard: T
): Omit<T, keyof RedactedDashboardMoney> & RedactedDashboardMoney {
  return {
    ...dashboard,
    budget: null, ledgerBudget: null, revenue: null, expenses: null,
    projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
    progressByBoqValuePct: null,
  }
}

/**
 * PROJEXA-BUILD-001 U-01d (2026-09-25, PM decision D2): the money fields of
 * one getOrgDashboard() project row (OrgDashboardProjectSummary), withheld
 * from a caller financialsAllowedForRole() refuses. list_delayed_activities
 * returns these rows, and it had no gate: every role, including the engine's
 * free-text dispatch and VERI FDE (both call it with no inputs), got each
 * delayed project's revenue, spend, budget, contract value and earned value.
 *
 * The list is api/v1/projexa/dashboard/route.ts's redaction of the same rows
 * plus projectValue, which that list leaves out. spendOverValue compares two
 * withheld figures, so it is null too (null, not false: "you may not see
 * this" is not "spend has not passed the contract value"). Name, task counts,
 * tasksLate, progressPercent, percentByActivity, permits and lastProgressAt
 * are not money and stay. Each row carries `financialsRedacted: true`.
 */
export function redactOrgProjectFinancials<T extends object>(project: T) {
  return {
    ...project,
    revenue: null, expenses: null, spent: null, budget: null, ledgerBudget: null,
    value: null, contractValue: null, projectValue: null,
    earnedValue: null, earnedValuePrevWeek: null, percentByValue: null, spendOverValue: null,
    financialsRedacted: true,
  }
}

/** U-01b: what a caller below manager rank reads where a budget judgement would have been. */
export const FINANCIALS_WITHHELD_SENTENCE = "Budget and cost figures are withheld for your role."

// U-01b: a KPI counts as money when its unit is a currency or its name is a
// money measure. KPIs are free-text definitions (construction-kpi-service.ts),
// so this reads the two fields a person filled in; anything else -- percent,
// hours, count, "Concrete Poured" -- stays visible.
const MONEY_KPI_UNIT = /[₹$€£]|(^|[^a-z])(inr|aed|usd|eur|gbp|sar|qar|omr|kwd|bhd|rs|rupees?|lakhs?|crores?|cr)([^a-z]|$)/i
const MONEY_KPI_NAME = /\b(budget|costs?|margins?|revenue|expenses?|spend|spent|profit|invoiced?|billing|billed|payments?|cash)\b/i

function isMoneyKpi(definition: { metricName?: string | null; unit?: string | null }): boolean {
  return MONEY_KPI_UNIT.test(definition.unit?.trim() ?? "") || MONEY_KPI_NAME.test(definition.metricName ?? "")
}

type KpiStatus = {
  definitions: Array<{ id: string; metricName?: string | null; unit?: string | null; targetValue?: string | null }>
  entries: Array<{ kpiDefinitionId: string; actualValue?: string | null }>
}

/**
 * PROJEXA-BUILD-001 U-01b (2026-09-25): the one step that withholds money from
 * the three construction tools that had no financial gate at all, for a caller
 * financialsAllowedForRole() refuses. Every result it returns carries
 * `financialsRedacted: true`; a manager's result never passes through it.
 *
 * - get_construction_kpi_status: a money KPI (isMoneyKpi) keeps its row but
 *   loses targetValue and every entry's actualValue; other KPIs are untouched.
 * - generate_construction_progress_summary: the model was already handed
 *   redactProjectDashboardFinancials(dashboard), so the summary has no money
 *   figure to repeat; this only adds the flag.
 * - detect_construction_budget_schedule_risk: the budget read was skipped
 *   (withholdBudget), so riskLevel rests on the schedule alone and the
 *   "actual X vs budget Y" sentence was never built; budgetRiskReasoning is
 *   replaced with FINANCIALS_WITHHELD_SENTENCE rather than "No budget is set",
 *   which would be untrue.
 */
export function withholdConstructionFinancials(codeReference: string, result: object): object {
  if (codeReference === "get_construction_kpi_status") {
    const { definitions, entries } = result as KpiStatus
    const moneyIds = new Set(definitions.filter(isMoneyKpi).map((d) => d.id))
    return {
      ...result,
      definitions: definitions.map((d) => (moneyIds.has(d.id) ? { ...d, targetValue: null } : d)),
      entries: entries.map((e) => (moneyIds.has(e.kpiDefinitionId) ? { ...e, actualValue: null } : e)),
      financialsRedacted: true,
    }
  }
  if (codeReference === "detect_construction_budget_schedule_risk") {
    return { ...result, budgetRiskReasoning: FINANCIALS_WITHHELD_SENTENCE, financialsRedacted: true }
  }
  return { ...result, financialsRedacted: true }
}

export async function dispatchConstructionTool(
  orgId: string,
  userId: string,
  codeReference: string,
  context?: { inputs?: Record<string, unknown> },
  role?: string | null,
  /**
   * R75 Part 2 (R-80): the CALLER's already-open transaction handle, when it
   * has one (e.g. the assistant route). Optional and defaults to undefined
   * so every OTHER existing caller of dispatchConstructionTool (there are
   * several across the codebase, not audited in this pass) keeps its exact
   * prior behavior unchanged -- only a caller that explicitly passes db
   * gets the nested-transaction fix, for the 3 codeReferences below that
   * have a WithDb sibling to use it with.
   */
  db?: TenantDb
): Promise<unknown> {
  // R48 gap-closure (2026-08-30, F089/F059): same rank check as the API
  // routes' own redaction. U-01 (2026-09-25): `role` undefined/null (caller
  // not wired to pass it) is now "unknown, so redact" -- see
  // financialsAllowedForRole() above.
  const financialsAllowed = financialsAllowedForRole(role)

  if (codeReference === "get_construction_project_dashboard") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { getProjectDashboard, getProjectDashboardsWithDb } = await import("@/lib/services/construction-dashboard-service")
    const dashboard = db
      ? (await getProjectDashboardsWithDb(db, { orgId }, [projectId]))[0]
      : await getProjectDashboard({ orgId }, projectId)
    if (!dashboard) throw new Error("Project not found")
    if (!financialsAllowed) return redactProjectDashboardFinancials(dashboard)
    return dashboard
  }

  if (codeReference === "list_delayed_activities") {
    const { getOrgDashboard, getOrgDashboardWithDb } = await import("@/lib/services/construction-dashboard-service")
    const dashboard = db ? await getOrgDashboardWithDb(db, { orgId }) : await getOrgDashboard({ orgId })
    const delayed = dashboard.projects.filter((p) => p.delayedTaskCount > 0)
    // U-01d: same array, same rows; below manager rank every money field is null.
    return financialsAllowed ? delayed : delayed.map(redactOrgProjectFinancials)
  }

  if (codeReference === "get_construction_budget_status") {
    if (!financialsAllowed) throw new Error("This action requires manager role or higher")
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { budgetVsActual, budgetVsActualWithDb } = await import("@/lib/services/construction-reports-service")
    return db
      ? budgetVsActualWithDb(db, { orgId }, projectId)
      : budgetVsActual({ orgId }, projectId)
  }

  if (codeReference === "list_over_budget_projects") {
    if (!financialsAllowed) throw new Error("This action requires manager role or higher")
    const { getOrgDashboard, getOrgDashboardWithDb, getProjectDashboards, getProjectDashboardsWithDb } = await import("@/lib/services/construction-dashboard-service")
    const orgDashboard = db ? await getOrgDashboardWithDb(db, { orgId }) : await getOrgDashboard({ orgId })
    // R67 E-06 (R-108) CORRECTION: getOrgDashboard()'s per-project summary
    // now DOES carry the same BOQ-derived budget, so this fan-out is no
    // longer necessary -- collapsing it belongs to the item that owns
    // removing per-project fan-outs (C01-10), not to this budget change.
    //
    // R75 Part 2 (R-80): was N separate getProjectDashboard() calls via
    // Promise.all -- each one its own withTenantContext, so calling this
    // codeReference from an already-open transaction (the assistant route)
    // opened up to 20 MORE nested transactions on top, the exact fan-out
    // shape R43_MGR_01 eliminated elsewhere in this file. getProjectDashboards
    // already batches multiple ids in ONE call; using it here removes both
    // the nesting hazard and the N+1 in one fix, and reads identically to
    // getOrgDashboard.projects/getProjectDashboard's own shape (same
    // ProjectDashboard[] type).
    const idsToCheck = orgDashboard.projects.slice(0, 20).map((p) => p.id)
    const results = db
      ? await getProjectDashboardsWithDb(db, { orgId }, idsToCheck)
      : await getProjectDashboards({ orgId }, idsToCheck)
    // R67 E-06: p.budget is the BOQ-derived figure, null (not 0) for a
    // project with no BOQ -- "we do not know this project's budget" is not
    // "this project is over budget". Reuses the one rule that decides this,
    // rather than restating it -- see construction-expense-service.ts.
    // (E-39 independently wrote the same `?? 0` guard inline here; D-02's
    // shared predicate reached main first and is the one kept, so there is one
    // definition of "over budget" rather than three.)
    const { budgetExceeded } = await import("@/lib/services/construction-expense-service")
    return results.filter((p) => budgetExceeded(p.budget, p.expenses))
  }

  // U-01b: the three codeReferences below had no financial gate; each now
  // goes through withholdConstructionFinancials() above for a caller below
  // manager rank, and is returned unchanged for one at or above it.
  if (codeReference === "get_construction_kpi_status") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { kpiReport, kpiReportWithDb } = await import("@/lib/services/construction-reports-service")
    const kpis = db ? await kpiReportWithDb(db, { orgId }, projectId) : await kpiReport({ orgId }, projectId)
    return financialsAllowed ? kpis : withholdConstructionFinancials(codeReference, kpis)
  }

  if (codeReference === "generate_construction_progress_summary") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { generateProgressSummary } = await import("@/lib/services/construction-ai-service")
    if (financialsAllowed) return generateProgressSummary({ orgId, userId }, projectId, db)
    const summary = await generateProgressSummary({ orgId, userId }, projectId, db, redactProjectDashboardFinancials)
    return withholdConstructionFinancials(codeReference, summary)
  }

  if (codeReference === "detect_construction_budget_schedule_risk") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { detectBudgetScheduleRisk } = await import("@/lib/services/construction-ai-service")
    if (financialsAllowed) return detectBudgetScheduleRisk({ orgId, userId }, projectId, db)
    const risk = await detectBudgetScheduleRisk({ orgId, userId }, projectId, db, { withholdBudget: true })
    return withholdConstructionFinancials(codeReference, risk)
  }

  throw new Error(`No dispatcher implemented for ${codeReference}`)
}
