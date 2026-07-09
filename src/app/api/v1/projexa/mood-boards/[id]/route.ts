import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateMoodBoardStatus, addMoodBoardItem, ServiceError } from "@/lib/services/interior-design-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body.action !== "status") return NextResponse.json({ error: "action must be 'status'" }, { status: 400 })
    const board = await updateMoodBoardStatus({ orgId: ctx.orgId }, id, body.status)
    return NextResponse.json(board)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa mood-board update error:", error)
    return NextResponse.json({ error: "Failed to update mood board" }, { status: 500 })
  }
}

// POST here adds an item -- kept on the board's own [id] route rather than
// a nested /items path, since a mood board item has no independent
// existence (always addressed through its parent board).
export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const item = await addMoodBoardItem({ orgId: ctx.orgId }, id, body)
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa mood-board add item error:", error)
    return NextResponse.json({ error: "Failed to add mood board item" }, { status: 500 })
  }
}
