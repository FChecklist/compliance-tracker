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

import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"

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
  role?: string | null
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
    const { getProjectDashboard } = await import("@/lib/services/construction-dashboard-service")
    const dashboard = await getProjectDashboard({ orgId }, projectId)
    if (!financialsAllowed) {
      return { ...dashboard, budget: null, revenue: null, expenses: null, projectValue: null, earnedValue: null, percentByValue: null, contractValue: null }
    }
    return dashboard
  }

  if (codeReference === "list_delayed_activities") {
    const { getOrgDashboard } = await import("@/lib/services/construction-dashboard-service")
    const dashboard = await getOrgDashboard({ orgId })
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
    const { getOrgDashboard, getProjectDashboard } = await import("@/lib/services/construction-dashboard-service")
    const orgDashboard = await getOrgDashboard({ orgId })
    // N+1, capped -- matches buildComplianceItemNodes()'s "quick-action
    // list, not a browse view" posture (see capability-tree-service.ts),
    // since getOrgDashboard()'s per-project summary doesn't carry budget.
    const results = await Promise.all(
      orgDashboard.projects.slice(0, 20).map((p) => getProjectDashboard({ orgId }, p.id))
    )
    // R67 D-02: p.budget is now `number | null` (null = no budget set at all,
    // which is not a budget of zero). Reuses the one rule that decides this,
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
    const { kpiReport } = await import("@/lib/services/construction-reports-service")
    return kpiReport({ orgId }, projectId)
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
