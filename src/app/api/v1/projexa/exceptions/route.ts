// Sumeet requirement (new, 2026-09-18): the 28-item, deterministic-boolean
// exceptions report ("PROJEXA-AI.COM SHOULD BE ABLE TO CAPTURE, ANALYZE,
// FIX, ALL OF THESE"). GET-only by design, matching v1/projexa/reports/
// boq-analysis/route.ts's own precedent -- this screen reports facts, it
// never writes anything; a project "fixing" one of these means acting on
// the underlying real record (approving the stuck CO, filing the missing
// diary, releasing the retention, ...) through that record's own existing
// screen, not through this route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getProjectExceptions } from "@/lib/services/construction-exceptions-service"
import { ServiceError } from "@/lib/services/compliance-service"

// ROLE FLOOR: "manager", same as v1/projexa/reports/boq-analysis's own
// precedent -- this report surfaces disputes, complaints, stuck approvals
// and self-approved change orders, materially more sensitive than the
// plain operational dashboards gated at "member" elsewhere.
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const checks = await getProjectExceptions({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ checks })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa exceptions report error:", error)
    return NextResponse.json({ error: "Failed to generate the exceptions report" }, { status: 500 })
  }
}
