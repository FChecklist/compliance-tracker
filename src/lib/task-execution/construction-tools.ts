// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Code
// Structure & Modularity): extracted from task-execution-engine.ts's
// dispatchTool() -- the Construction Intelligence (PROJEXA, Wave 128)
// slice of that function's if-chain, unchanged in behavior, just relocated
// + grouped by responsibility. See compliance-tools.ts's header for the
// full extraction rationale.
//
// All read-only, matching dispatchTool()'s read-only-auto-dispatch
// contract. Each independently opens its own withTenantContext transaction
// via the service call (no shared `db` param needed here, unlike
// compliance-tools.ts/gst-tools.ts) -- same posture as the original inline
// implementation.

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
  context?: { inputs?: Record<string, unknown> }
): Promise<unknown> {
  if (codeReference === "get_construction_project_dashboard") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { getProjectDashboard } = await import("@/lib/services/construction-dashboard-service")
    return getProjectDashboard({ orgId }, projectId)
  }

  if (codeReference === "list_delayed_activities") {
    const { getOrgDashboard } = await import("@/lib/services/construction-dashboard-service")
    const dashboard = await getOrgDashboard({ orgId })
    return dashboard.projects.filter((p) => p.delayedTaskCount > 0)
  }

  if (codeReference === "get_construction_budget_status") {
    const projectId = String(context?.inputs?.projectId ?? "")
    if (!projectId) throw new Error("Missing projectId")
    const { budgetVsActual } = await import("@/lib/services/construction-reports-service")
    return budgetVsActual({ orgId }, projectId)
  }

  if (codeReference === "list_over_budget_projects") {
    const { getOrgDashboard, getProjectDashboard } = await import("@/lib/services/construction-dashboard-service")
    const orgDashboard = await getOrgDashboard({ orgId })
    // N+1, capped -- matches buildComplianceItemNodes()'s "quick-action
    // list, not a browse view" posture (see capability-tree-service.ts),
    // since getOrgDashboard()'s per-project summary doesn't carry budget.
    const results = await Promise.all(
      orgDashboard.projects.slice(0, 20).map((p) => getProjectDashboard({ orgId }, p.id))
    )
    return results.filter((p) => p.budget > 0 && p.expenses > p.budget)
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
