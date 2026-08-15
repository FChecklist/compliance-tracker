// Task #46 (CRM feature-parity gap analysis): opportunity-side twin of
// leads/auto-distribute/route.ts -- same rationale, same two request shapes
// (Manual Assign vs Auto Assign), same manager/write RBAC gate as the
// sibling bulk-reassign/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { autoDistributeOpportunities, manualAssignUnassigned, ServiceError } from "@/lib/services/crm-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json().catch(() => ({}))
    const order = body.order === "newest_first" ? "newest_first" : "oldest_first"

    if (body.targetUserId && body.count) {
      const result = await manualAssignUnassigned({ orgId: ctx.orgId, userId: actorId }, "opportunity", body.targetUserId, Number(body.count), order)
      return NextResponse.json(result)
    }

    const result = await autoDistributeOpportunities({ orgId: ctx.orgId, userId: actorId }, {
      order,
      sharingCount: body.sharingCount != null ? Number(body.sharingCount) : undefined,
      targetUserIds: Array.isArray(body.targetUserIds) ? body.targetUserIds : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa opportunities auto-distribute error:", error)
    return NextResponse.json({ error: "Failed to auto-distribute opportunities" }, { status: 500 })
  }
}
