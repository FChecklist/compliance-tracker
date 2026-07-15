// Priority 17 Wave 1: thin alias over knowledge-base-service.ts's
// updateKbPage(). No gate -- see ../route.ts header.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateKbPage, ServiceError } from "@/lib/services/knowledge-base-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateKbPage({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa knowledge-base update error:", error)
    return NextResponse.json({ error: "Failed to update knowledge base page" }, { status: 500 })
  }
}
