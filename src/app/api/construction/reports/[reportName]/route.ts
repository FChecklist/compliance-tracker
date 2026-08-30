// Wave 122: explicit dispatcher (not a fully generic one) matching this
// repo's existing custom-report-service.ts posture -- see that file's own
// comment on why arbitrary query dispatch is avoided on a multi-tenant DB.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, hasRole } from "@/lib/supabase/auth-guard"
import { REPORT_REGISTRY, ServiceError, type ReportName } from "@/lib/services/construction-reports-service"

function isValidReportName(value: string): value is ReportName {
  return value in REPORT_REGISTRY
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { reportName } = await params
  if (!isValidReportName(reportName)) {
    return NextResponse.json({ error: `Unknown report. Valid reports: ${Object.keys(REPORT_REGISTRY).join(", ")}` }, { status: 400 })
  }
  // R48 gap-closure (2026-08-30, F003/F059) -- see the sibling v1 route's
  // comment for the full reasoning.
  if (reportName === "budget-vs-actual" && !hasRole(dbUser, "manager")) {
    return NextResponse.json({ error: "This report requires manager role or higher" }, { status: 403 })
  }

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    let result
    if (reportName === "weekly-project") {
      const weekStart = request.nextUrl.searchParams.get("weekStart")
      if (!weekStart) return NextResponse.json({ error: "weekStart query param is required for the weekly-project report" }, { status: 400 })
      result = await REPORT_REGISTRY[reportName]({ orgId }, projectId, weekStart)
    } else if (reportName === "work-analysis") {
      const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? undefined
      const dateTo = request.nextUrl.searchParams.get("dateTo") ?? undefined
      result = await REPORT_REGISTRY[reportName]({ orgId }, projectId, dateFrom, dateTo)
    } else if (reportName === "certified-payroll") {
      const weekStart = request.nextUrl.searchParams.get("weekStart")
      if (!weekStart) return NextResponse.json({ error: "weekStart query param is required for the certified-payroll report" }, { status: 400 })
      result = await REPORT_REGISTRY[reportName]({ orgId }, projectId, weekStart)
    } else if (reportName === "manpower-cost") {
      const date = request.nextUrl.searchParams.get("date") ?? undefined
      result = await REPORT_REGISTRY[reportName]({ orgId }, projectId, date)
    } else {
      result = await REPORT_REGISTRY[reportName]({ orgId }, projectId)
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error(`Construction report "${reportName}" error:`, error)
    return NextResponse.json({ error: `Failed to generate ${reportName} report` }, { status: 500 })
  }
}
