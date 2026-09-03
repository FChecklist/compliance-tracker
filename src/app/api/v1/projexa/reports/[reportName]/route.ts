import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, hasRole } from "@/lib/supabase/auth-guard"
import { REPORT_REGISTRY, ServiceError, type ReportName } from "@/lib/services/construction-reports-service"

function isValidReportName(value: string): value is ReportName {
  return value in REPORT_REGISTRY
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { reportName } = await params
  if (!isValidReportName(reportName)) {
    return NextResponse.json({ error: `Unknown report. Valid reports: ${Object.keys(REPORT_REGISTRY).join(", ")}` }, { status: 400 })
  }
  // R48 gap-closure (2026-08-30, F003/F059: "sees no budget or margin
  // figures anywhere"). This dispatcher had no role gate at all -- unlike
  // the dashboard (fixed separately), a rank-1 viewer or rank-2 member
  // could call this report by name directly and get real budget/margin
  // data. Gated only the one report whose whole purpose is that figure,
  // same minimal-redaction posture as the dashboard fix (other reports
  // here -- progress, schedule, manpower-cost -- are operational data a
  // site engineer legitimately needs, not gated).
  if (reportName === "budget-vs-actual" && ctx.dbUser && !hasRole(ctx.dbUser, "manager")) {
    return NextResponse.json({ error: "This report requires manager role or higher" }, { status: 403 })
  }

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    let result
    if (reportName === "weekly-project") {
      const weekStart = request.nextUrl.searchParams.get("weekStart")
      if (!weekStart) return NextResponse.json({ error: "weekStart query param is required for the weekly-project report" }, { status: 400 })
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, weekStart)
    } else if (reportName === "certified-payroll") {
      const weekStart = request.nextUrl.searchParams.get("weekStart")
      if (!weekStart) return NextResponse.json({ error: "weekStart query param is required for the certified-payroll report" }, { status: 400 })
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, weekStart)
    } else if (reportName === "work-progress") {
      // R67 lane I (WS-I item I-05, R-177): the Category multi-select on the
      // WPR parameter bar. Repeatable `category` params (?category=Civil&
      // category=Paint) rather than one comma-joined value -- a real category
      // name may legitimately contain a comma, and splitting on it would
      // silently filter for a category nobody has. Omitting the param entirely
      // keeps the previous every-category behaviour.
      const categoryFilter = request.nextUrl.searchParams.getAll("category").filter((c) => c.trim() !== "")
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, { categoryFilter })
    } else if (reportName === "manpower-cost") {
      // R39/R-C07: both optional -- omitted keeps the existing all-time,
      // all-trade behavior.
      const date = request.nextUrl.searchParams.get("date") ?? undefined
      const trade = request.nextUrl.searchParams.get("trade") ?? undefined
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, date, trade)
    } else if (reportName === "manpower-daily-summary") {
      // R67 D-53: one date, and it defaults to today inside the service rather
      // than here, so a direct service caller and this dispatcher can never
      // disagree about which day "no date" means.
      const date = request.nextUrl.searchParams.get("date") ?? undefined
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, date)
    } else {
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId)
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error(`v1 projexa report "${reportName}" error:`, error)
    return NextResponse.json({ error: `Failed to generate ${reportName} report` }, { status: 500 })
  }
}
