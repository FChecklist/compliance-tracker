import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, hasRole } from "@/lib/supabase/auth-guard"
import { getOrgDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (found via R43_EXEC_01 investigation, 2026-08-27):
  // this read had no floor at all -- rank-1 roles (viewer/client_viewer/
  // external_auditor/stage_0, see ROLE_RANK in auth-guard.ts) could read every
  // project's revenue/expenses/budget. Matches the exact
  // requireRoleOrScope(ctx, "member", "read") pattern already used identically
  // by 10 sibling /api/v1/projexa/** and /api/v1/brain/** GET routes.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  // E-52: previously returned 200 { totalProjects: 0, ..., projects: [] }
  // here -- this is the first screen PROJEXA renders after login, so a
  // broken org context silently rendered as a legitimate all-zeros org, the
  // exact class of silent-empty-200 that produced the dashboard currency
  // bug (E-11). Every sibling v1 GET with this guard now returns 400.
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const summary = await getOrgDashboard({ orgId: ctx.orgId }, { departmentId: request.nextUrl.searchParams.get("departmentId") ?? undefined })
    // R48 gap-closure (2026-08-30, F059: "MEMBER cannot see budget or
    // margin"). This is the REAL route the (app)/construction-dashboard
    // page calls (confirmed live: it fetches /api/v1/projexa/dashboard, not
    // /api/construction/dashboard's own copy of this same logic). The
    // requireRoleOrScope() call above deliberately floors at "member" (see
    // E-52/API_READ_WITHOUT_ROLE_CHECK comment) -- correct for the page to
    // load at all, but it never redacted financial figures for that "member"
    // rank, so a site engineer received the same budget/revenue/expenses as
    // a manager once the page loaded. Redact server-side instead of gating
    // the whole route -- a member still needs task counts/delayed counts.
    if (ctx.dbUser && !hasRole(ctx.dbUser, "manager")) {
      return NextResponse.json({
        ...summary,
        totalBudget: null, totalRevenue: null, totalExpenses: null,
        // R67 E-01: spendOverValue is DERIVED from expenses against the
        // contract value, so leaving it in would hand a member the very
        // comparison the two redacted figures exist to withhold -- redacted
        // to null (not false), because "you may not see this" and "spend has
        // not passed the contract value" are different statements.
        // percentByActivity and permitsExpiring30d stay: neither is financial,
        // and a site engineer's whole job depends on both.
        projects: summary.projects.map((p) => ({ ...p, revenue: null, expenses: null, earnedValue: null, percentByValue: null, spendOverValue: null })),
      })
    }
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 })
  }
}
