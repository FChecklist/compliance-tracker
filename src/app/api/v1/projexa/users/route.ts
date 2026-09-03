// R67 D-19: the org directory PROJEXA's MoM action-item form said did not
// exist. Thin ALIASING route, zero new business logic and NO new service --
// it calls hr-service.ts's already-shipped listEmployees() (the users read
// path) and its pure filterOrgUsersByQuery() helper, exactly the same posture
// as /api/v1/projexa/employees next door.
//
// WHY NOT JUST USE /employees: that route returns the full employee record
// (job title, employment status, joining/birth dates, emergency contacts) --
// PII a picker has no business shipping to a browser on every keystroke. This
// returns id/name/email/role only.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listEmployees, filterOrgUsersByQuery, ORG_USER_PICKER_LIMIT, ServiceError } from "@/lib/services/hr-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // Same floor as /employees' own read (API_READ_WITHOUT_ROLE_CHECK): the
  // rank-1 read-only roles do not get the org's people list.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const q = request.nextUrl.searchParams.get("q")
    const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10)
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : ORG_USER_PICKER_LIMIT
    const orgUsers = await listEmployees({ orgId: ctx.orgId })
    return NextResponse.json({ users: filterOrgUsersByQuery(orgUsers, q, limit) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa org users list error:", error)
    return NextResponse.json({ error: "Failed to fetch the organisation's people" }, { status: 500 })
  }
}
