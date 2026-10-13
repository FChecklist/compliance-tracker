import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, hasRole } from "@/lib/supabase/auth-guard"
import { REPORT_REGISTRY, ServiceError, buildReportTable } from "@/lib/services/construction-reports-service"
import { isValidReportName, runReportPayload } from "@/lib/services/report-run-dispatch"
import { getBaseCurrency } from "@/lib/services/erp-accounting-service"

const VALID_REPORT_NAMES = Object.keys(REPORT_REGISTRY).join(", ")

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { reportName } = await params
  if (!isValidReportName(reportName)) {
    return NextResponse.json({ error: `Unknown report. Valid reports: ${VALID_REPORT_NAMES}` }, { status: 400 })
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
    // Parameter handling per report lives in one place so the /export sibling reads them identically.
    const result = await runReportPayload(ctx.orgId, reportName, request.nextUrl.searchParams, projectId)

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
