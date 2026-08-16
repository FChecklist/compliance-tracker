import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { removeMoodBoardItem, ServiceError } from "@/lib/services/interior-design-service"

type RouteContext = { params: Promise<{ id: string; itemId: string }> }

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id, itemId } = await params
    const result = await removeMoodBoardItem({ orgId: ctx.orgId }, id, itemId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa mood-board remove item error:", error)
    return NextResponse.json({ error: "Failed to remove mood board item" }, { status: 500 })
  }
}
