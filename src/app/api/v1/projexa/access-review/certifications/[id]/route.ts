// Priority 15 (PROJEXA GRC module, depth pass): thin ALIASING route over
// access-review-service.ts's reviewCertification -- confirm or revoke a
// single user's certified role. "Revoked" has real teeth: it flips that
// user's isActive to false (enforced by requireAuth(), same wave as the
// underlying service).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { reviewCertification, ServiceError } from "@/lib/services/access-review-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body.decision !== "confirmed" && body.decision !== "revoked") {
      return NextResponse.json({ error: "decision must be 'confirmed' or 'revoked'" }, { status: 400 })
    }
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const certification = await reviewCertification(actorCtx, id, body.decision)
    return NextResponse.json(certification)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa access-review certification decide error:", error)
    return NextResponse.json({ error: "Failed to record certification decision" }, { status: 500 })
  }
}
