// Task #46 (CRM feature-parity gap analysis): thin alias over
// crm-service.ts's autoDistributeLeads/manualAssignUnassigned. Same
// manager/write RBAC gate as the sibling bulk-reassign/route.ts, since this
// also mutates ownerId across many leads at once.
//
// Two request shapes, matching the reference's two assignment modes:
// - body.targetUserId + body.count present => "Manual Assign": the N
//   oldest/newest unassigned leads go to that one user (delegates to
//   manualAssignUnassigned, itself a thin wrapper over bulkReassignLeads).
// - otherwise => "Auto Assign": every currently-unassigned lead is
//   round-robin/least-loaded across all active org users (or an explicit
//   targetUserIds pool + optional per-user sharingCount cap).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { autoDistributeLeads, manualAssignUnassigned, ServiceError } from "@/lib/services/crm-service"

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
      const result = await manualAssignUnassigned({ orgId: ctx.orgId, userId: actorId }, "lead", body.targetUserId, Number(body.count), order)
      return NextResponse.json(result)
    }

    const result = await autoDistributeLeads({ orgId: ctx.orgId, userId: actorId }, {
      order,
      sharingCount: body.sharingCount != null ? Number(body.sharingCount) : undefined,
      targetUserIds: Array.isArray(body.targetUserIds) ? body.targetUserIds : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leads auto-distribute error:", error)
    return NextResponse.json({ error: "Failed to auto-distribute leads" }, { status: 500 })
  }
}
