// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's createAuditFinding. Findings are read via
// audit-engagements/route.ts (embedded per engagement) -- there is no
// separate flat findings list in the underlying service, matching the
// original session-only /api/audit-findings route's own scope (create only).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { createAuditFinding, ServiceError } from "@/lib/services/risk-register-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const body = await request.json()
    const actorCtx = { orgId: ctx.orgId, userId: acting.person.id, ...acting.actor }
    const finding = await createAuditFinding(actorCtx, {
      auditEngagementId: body.auditEngagementId, title: body.title, severity: body.severity,
      dueDate: body.dueDate, linkedRiskId: body.linkedRiskId,
    })
    return NextResponse.json(finding, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa audit-finding create error:", error)
    return NextResponse.json({ error: "Failed to create audit finding" }, { status: 500 })
  }
}
