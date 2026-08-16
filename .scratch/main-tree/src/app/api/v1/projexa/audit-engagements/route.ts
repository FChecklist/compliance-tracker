// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's Audit Engagements -- each engagement embeds
// its own findings (severity + CAPA remediation status), the "findings +
// remediation tracking" surface. Zero new business logic.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listAuditEngagements, createAuditEngagement, ServiceError } from "@/lib/services/risk-register-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ engagements: [] })

  try {
    const engagements = await listAuditEngagements({ orgId: ctx.orgId })
    return NextResponse.json({ engagements })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa audit-engagements list error:", error)
    return NextResponse.json({ error: "Failed to fetch audit engagements" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const engagement = await createAuditEngagement(actorCtx, { name: body.name, auditType: body.auditType, coversRiskIds: body.coversRiskIds })
    return NextResponse.json(engagement, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa audit-engagement create error:", error)
    return NextResponse.json({ error: "Failed to create audit engagement" }, { status: 500 })
  }
}
