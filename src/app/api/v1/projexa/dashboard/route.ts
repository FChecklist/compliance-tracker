import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
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
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 })
  }
}
