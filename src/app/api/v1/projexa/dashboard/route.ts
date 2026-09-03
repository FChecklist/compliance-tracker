import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, hasRole } from "@/lib/supabase/auth-guard"
import { getOrgDashboard, getProjectDashboards, ServiceError } from "@/lib/services/construction-dashboard-service"
import { withRouteTiming } from "@/lib/route-timing"

/** Cap on ?projectIds= -- a portfolio view, not an unbounded fan-out. */
const MAX_BATCH_PROJECTS = 50

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
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

  // R67 F-27 (audit recommendation R-243): ?projectIds=a,b,c answers a
  // PORTFOLIO in ONE call. The per-project dashboard used to be one request per
  // project, each of which was itself about ten sequential aggregates -- so a
  // ten-project portfolio was a hundred round trips to a remote pooler. The
  // service answers every id in one statement (see getProjectDashboards).
  //
  // The org-level summary below is untouched: it answers a different question
  // (totals across every active project) and every existing caller of this
  // route keeps getting exactly it.
  const projectIdsParam = request.nextUrl.searchParams.get("projectIds")
  if (projectIdsParam !== null) {
    const ids = projectIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json({ error: "projectIds was empty" }, { status: 400 })
    if (ids.length > MAX_BATCH_PROJECTS) {
      return NextResponse.json(
        { error: `Too many projects in one request: ${ids.length}. The maximum is ${MAX_BATCH_PROJECTS}.` },
        { status: 400 }
      )
    }
    try {
      const dashboards = await getProjectDashboards({ orgId: ctx.orgId }, ids)
      // Same redaction rule the org summary and the single-project route
      // already apply (R48 F059): a member sees task counts, not money.
      if (ctx.dbUser && !hasRole(ctx.dbUser, "manager")) {
        return NextResponse.json({
          dashboards: dashboards.map((d) => ({
            ...d,
            budget: null, revenue: null, expenses: null,
            projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
          })),
        })
      }
      return NextResponse.json({ dashboards })
    } catch (error) {
      if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
      console.error("v1 projexa dashboard batch error:", error)
      return NextResponse.json({ error: "Failed to fetch the project dashboards" }, { status: 500 })
    }
  }

  try {
    // R67 E-23: from/to narrow revenue and expenses only -- the BOQ-derived
    // budget is a property of the BOQ line, not of a period. See
    // OrgDashboardFilters' own comment; the chart states the same thing to
    // the reader.
    const summary = await getOrgDashboard({ orgId: ctx.orgId }, {
      departmentId: request.nextUrl.searchParams.get("departmentId") ?? undefined,
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
    })
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
    // R67 E-21: getOrgDashboard's project rows gained contractValue,
    // earnedValuePrevWeek, budget and spent. Every one of those is a
    // financial figure, so each is redacted here alongside the four that
    // already were -- adding a money field to the service without adding it
    // to this list is exactly how F059 happened the first time.
    // progressPercent, tasksDue/tasksLate and hasSchedule are NOT money and
    // stay visible: a site engineer still needs their own schedule.
    if (ctx.dbUser && !hasRole(ctx.dbUser, "manager")) {
      return NextResponse.json({
        ...summary,
        totalBudget: null, totalRevenue: null, totalExpenses: null,
        projects: summary.projects.map((p) => ({
          ...p,
          revenue: null, expenses: null, spent: null, budget: null, boqBudget: null,
          value: null, contractValue: null,
          earnedValue: null, earnedValuePrevWeek: null, percentByValue: null,
        })),
      })
    }
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 })
  }
}
