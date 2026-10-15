// Sumeet R-C15 / R-C11 (2026-10-13): ONE place that knows how each named report reads its query parameters and runs.
// Both GET /api/v1/projexa/reports/[reportName] (the on-screen table) and its /export sibling (PDF / XLSX / CSV) call this, so a downloaded
// file is built from exactly the rows the screen showed: there is no second opinion about weekStart, category, date, trade or boqId.
import { REPORT_REGISTRY, ServiceError, type ReportName } from "@/lib/services/construction-reports-service"

export function isValidReportName(value: string): value is ReportName {
  return value in REPORT_REGISTRY
}

/** Runs the report and returns the handler's own payload. Throws ServiceError for a missing/invalid parameter (400) exactly as the services do. */
export async function runReportPayload(orgId: string, reportName: ReportName, sp: URLSearchParams, projectId: string): Promise<unknown> {
  const ctx = { orgId }
  if (reportName === "weekly-project") {
    const weekStart = sp.get("weekStart")
    if (!weekStart) throw new ServiceError("weekStart query param is required for the weekly-project report", 400)
    return REPORT_REGISTRY[reportName](ctx, projectId, weekStart)
  }
  if (reportName === "certified-payroll") {
    const weekStart = sp.get("weekStart")
    if (!weekStart) throw new ServiceError("weekStart query param is required for the certified-payroll report", 400)
    return REPORT_REGISTRY[reportName](ctx, projectId, weekStart)
  }
  if (reportName === "work-progress") {
    // Repeatable `category` (a real category name may contain a comma). Omitted = every category.
    const categoryFilter = sp.getAll("category").filter((c) => c.trim() !== "")
    return REPORT_REGISTRY[reportName](ctx, projectId, { categoryFilter })
  }
  if (reportName === "budget-variance") {
    const categories = sp.getAll("category").filter((c) => c.trim() !== "")
    const vendorId = sp.get("vendorId") ?? undefined
    const groupBy = sp.get("groupBy") === "category" ? "category" : "scope"
    return REPORT_REGISTRY[reportName](ctx, projectId, { categories, vendorId, groupBy })
  }
  if (reportName === "designer-timesheet") {
    const from = sp.get("from") ?? undefined
    const to = sp.get("to") ?? undefined
    return REPORT_REGISTRY[reportName](ctx, projectId, { from, to })
  }
  if (reportName === "manpower-cost") {
    const date = sp.get("date") ?? undefined
    const trade = sp.get("trade") ?? undefined
    return REPORT_REGISTRY[reportName](ctx, projectId, date, trade)
  }
  if (reportName === "manpower-daily-summary") {
    const date = sp.get("date") ?? undefined
    return REPORT_REGISTRY[reportName](ctx, projectId, date)
  }
  if (reportName === "category-boq-amounts") {
    const boqId = sp.get("boqId") ?? undefined
    return REPORT_REGISTRY[reportName](ctx, projectId, { boqId })
  }
  return REPORT_REGISTRY[reportName](ctx, projectId)
}
