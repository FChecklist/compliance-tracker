import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getOrgDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"
import { financialsAllowedForRole, redactOrgProjectFinancials } from "@/lib/task-execution/construction-tools"

export async function GET(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ totalProjects: 0, totalBudget: null, totalLedgerBudget: 0, totalRevenue: 0, totalExpenses: 0, projects: [] })

  try {
    const summary = await getOrgDashboard({ orgId }, {
      departmentId: request.nextUrl.searchParams.get("departmentId") ?? undefined,
    })
    // R48 gap-closure (2026-08-30, F059) -- see the sibling [projectId]
    // route's comment for the full reasoning. Same redaction, applied to
    // the org-wide summary's totals and per-project figures.
    //
    // PROJEXA-BUILD-001 U-01e (2026-09-25): the rule is now
    // financialsAllowedForRole() (a known role of manager rank or above) and
    // the row list is redactOrgProjectFinancials(), the same two the v1 route
    // and list_delayed_activities use. This file's own row list had drifted
    // from the v1 route's: spent, ledgerBudget, value, contractValue,
    // projectValue and earnedValuePrevWeek all reached a member. The role is
    // the session user's own: requireAuth() admits no API key, so there is no
    // acting person to resolve here, and no dbUser or no role reads as
    // "redacted".
    if (!financialsAllowedForRole(dbUser?.role ?? null)) {
      return NextResponse.json({
        ...summary,
        // R67 E-06: totalLedgerBudget and the per-project budget are financial
        // figures too -- redacted alongside the one they were split out of.
        totalBudget: null, totalLedgerBudget: null, totalRevenue: null, totalExpenses: null,
        financialsRedacted: true,
        // R67 E-01 fix pass: spendOverValue is DERIVED from expenses against
        // the contract value, and `value` itself is spread straight through --
        // so leaving the verdict in handed a member exactly the comparison
        // redacting revenue/expenses/budget exists to withhold. null (not
        // false), because "you may not see this" and "spend has not passed the
        // contract value" are different statements. redactOrgProjectFinancials()
        // nulls it with every other money field and marks each row
        // financialsRedacted: true.
        projects: summary.projects.map(redactOrgProjectFinancials),
      })
    }
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction org dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 })
  }
}
