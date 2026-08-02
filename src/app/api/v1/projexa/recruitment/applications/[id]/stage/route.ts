// Priority 15 (PROJEXA HR & Payroll, Wave 1): moves an application through
// the pipeline (applied -> screening -> interview -> offer -> hired /
// rejected) via recruitment-service.ts's real VALID_STAGE_TRANSITIONS guard.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { moveApplicationStage, ServiceError } from "@/lib/services/recruitment-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await params
    const body = await request.json()
    const updated = await moveApplicationStage({ orgId: ctx.orgId, userId: actorId }, id, body.stage, {
      rejectedReason: body.rejectedReason, offerAmount: body.offerAmount,
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa application stage move error:", error)
    return NextResponse.json({ error: "Failed to move application stage" }, { status: 500 })
  }
}
