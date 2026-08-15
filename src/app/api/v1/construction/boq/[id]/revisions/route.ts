// Wave 127 (task-20260727-190032): revision creation was internal-only --
// PROJEXA's own "new revision" screen had no v1 endpoint to call. Real
// Owner directive enforced here (via createBoqRevision itself): a negative
// variation that reduces already-completed work is blocked with a 409
// unless the caller explicitly passes allowScopeReductionOverride: true.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createBoqRevision, ServiceError } from "@/lib/services/construction-boq-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await createBoqRevision({ orgId: ctx.orgId, userId: actorId }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ revision create error:", error)
    return NextResponse.json({ error: "Failed to create BOQ revision" }, { status: 500 })
  }
}
