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
  // routes' own redaction. `role` undefined (caller not yet wired to pass
  // it) is treated as "unknown, don't redact" to preserve prior behavior
  // for those callers -- see task-execution-engine.ts's dispatchTool() own
  // comment.
  const financialsAllowed = role ? (ROLE_RANK[role as UserRole] ?? 0) >= ROLE_RANK.manager : true

  if (codeReference === "get_construction_project_dashboard") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { getProjectDashboard, getProjectDashboardsWithDb } = await import("@/lib/services/construction-dashboard-service")
    const dashboard = db
      ? (await getProjectDashboardsWithDb(db, { orgId }, [projectId]))[0]
      : await getProjectDashboard({ orgId }, projectId)
    if (!dashboard) throw new Error("Project not found")
    if (!financialsAllowed) {
      return { ...dashboard, budget: null, revenue: null, expenses: null, projectValue: null, earnedValue: null, percentByValue: null, contractValue: null }
    }
    return dashboard
  }

  if (codeReference === "list_delayed_activities") {
    const { getOrgDashboard, getOrgDashboardWithDb } = await import("@/lib/services/construction-dashboard-service")
    const dashboard = db ? await getOrgDashboardWithDb(db, { orgId }) : await getOrgDashboard({ orgId })
    return dashboard.projects.filter((p) => p.delayedTaskCount > 0)
  }

  if (codeReference === "get_construction_budget_status") {
    if (!financialsAllowed) throw new Error("This action requires manager role or higher")
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { budgetVsActual } = await import("@/lib/services/construction-reports-service")
    return budgetVsActual({ orgId }, projectId)
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

  if (codeReference === "get_construction_kpi_status") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { kpiReport, kpiReportWithDb } = await import("@/lib/services/construction-reports-service")
    return db ? kpiReportWithDb(db, { orgId }, projectId) : kpiReport({ orgId }, projectId)
  }

  if (codeReference === "generate_construction_progress_summary") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { generateProgressSummary } = await import("@/lib/services/construction-ai-service")
    return generateProgressSummary({ orgId, userId }, projectId)
  }

  if (codeReference === "detect_construction_budget_schedule_risk") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { detectBudgetScheduleRisk } = await import("@/lib/services/construction-ai-service")
    return detectBudgetScheduleRisk({ orgId, userId }, projectId)
  }

  throw new Error(`No dispatcher implemented for ${codeReference}`)
}
