import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, hasRole } from "@/lib/supabase/auth-guard"
import { buildBudgetVsActualByProject, ServiceError } from "@/lib/services/construction-reports-service"
import { getOrgDashboard } from "@/lib/services/construction-dashboard-service"
import { getBaseCurrency } from "@/lib/services/erp-accounting-service"

// R67 E-33 (R-265). Sumeet 5.png's first graph: revenue, budget and progress
// per project, across the portfolio, in the {columns, rows} contract E-32
// gave every other report.
//
// WHY IT IS NOT /reports/budget-vs-actual. That name already exists as a
// PER-PROJECT report dispatched through /reports/[reportName]?projectId=, and
// a static sibling segment would shadow that dynamic one -- the existing
// report would stop being reachable, silently, for the one name a chart
// happens to want. This sits two segments deep, where nothing collides, and
// the name says what makes it different: a portfolio, not a project.
//
// ROLE GATE. Same posture as the per-project budget-vs-actual beside it
// (R48 F003/F059): a report whose whole purpose is the budget figure is
// manager-and-above. An API-key caller (PROJEXA's server-to-server hop) has no
// dbUser to rank and is gated by the key's own scope, exactly as that route
// does it.
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (ctx.dbUser && !hasRole(ctx.dbUser, "manager")) {
    return NextResponse.json({ error: "This report requires manager role or higher" }, { status: 403 })
  }

  try {
    // The optional filters getOrgDashboard already understands, so the chart
    // above it can carry a date range without a second endpoint. Omitted means
    // every department and every date, exactly as before.
    const departmentId = request.nextUrl.searchParams.get("departmentId") ?? undefined
    const from = request.nextUrl.searchParams.get("from") ?? undefined
    const to = request.nextUrl.searchParams.get("to") ?? undefined

    const dashboard = await getOrgDashboard({ orgId: ctx.orgId }, { departmentId, from, to })
    // Sequential, not Promise.all: each of these opens its own tenant
    // transaction and this route must never hold two pooled connections at
    // once (the R66 pool-deadlock rule). A missing base currency is a real
    // org-setup state and never fails the report.
    const currency = await getBaseCurrency({ orgId: ctx.orgId })
      .then((c) => c.baseCurrency?.code ?? null)
      .catch(() => null)

    return NextResponse.json(buildBudgetVsActualByProject(dashboard.projects, currency))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa portfolio budget-vs-actual report error:", error)
    return NextResponse.json({ error: "Failed to generate the portfolio budget vs actual report" }, { status: 500 })
  }
}
