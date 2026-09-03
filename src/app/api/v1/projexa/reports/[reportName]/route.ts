import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, hasRole } from "@/lib/supabase/auth-guard"
import { REPORT_REGISTRY, ServiceError, buildReportTable, type ReportName } from "@/lib/services/construction-reports-service"
import { getBaseCurrency } from "@/lib/services/erp-accounting-service"

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
    } else if (reportName === "budget-variance") {
      // R67 E-07 (R-114) + E-08 (R-115): the Cost Variance screen's real
      // Category and Vendor filters, and the Revenue/Budget/Actual view's
      // scope|category fold. Repeatable `category` params for the same reason
      // the work-progress report above uses them -- a real category name may
      // contain a comma, and splitting on one would filter for a category
      // nobody has. Omitting every param keeps the previous whole-BOQ,
      // scope-wise behaviour byte for byte.
      const categories = request.nextUrl.searchParams.getAll("category").filter((c) => c.trim() !== "")
      const vendorId = request.nextUrl.searchParams.get("vendorId") ?? undefined
      const groupBy = request.nextUrl.searchParams.get("groupBy") === "category" ? "category" : "scope"
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, { categories, vendorId, groupBy })
    } else if (reportName === "designer-timesheet") {
      // R67 E-16 (R-150): the Design Studio Cost Analysis screen defaults to
      // the current month, so this report finally takes one. Omitting both
      // keeps the previous whole-history behaviour for existing API callers.
      const from = request.nextUrl.searchParams.get("from") ?? undefined
      const to = request.nextUrl.searchParams.get("to") ?? undefined
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, { from, to })
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

    // R67 E-32 (R-265). THE DEFAULT IS NOW A TABLE.
    //
    // Every report answers as { columns, rows, totals?, currency } so PROJEXA
    // has one renderer instead of five bespoke ones and a JSON key-value dump
    // for the other eighteen. `?format=legacy` serves the handler's own payload
    // unchanged for one release, for callers that read specific fields -- the
    // WPR exports and the dashboards read the SERVICES directly and are
    // untouched either way.
    //
    // The currency is fetched only for the table shape, and only after the
    // report itself succeeded: getBaseCurrency opens its own transaction, and
    // this route must never hold two pooled connections at once (the R66
    // pool-deadlock rule).
    if (request.nextUrl.searchParams.get("format") === "legacy") {
      return NextResponse.json(result)
    }
    // A missing base currency is a real org-setup state, not a failure of the
    // report -- the table says the currency is unset and still shows the
    // numbers, so one unconfigured setting never blanks a whole report.
    const currency = await getBaseCurrency({ orgId: ctx.orgId })
      .then((c) => c.baseCurrency?.code ?? null)
      .catch(() => null)
    return NextResponse.json(buildReportTable(reportName, result, currency))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error(`v1 projexa report "${reportName}" error:`, error)
    return NextResponse.json({ error: `Failed to generate ${reportName} report` }, { status: 500 })
  }
}
