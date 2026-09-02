// R67 lane I (WS-I item I-05, R-177): rename or retire one BOQ category.
//
// A rename here rewrites every BOQ line that carried the category's PREVIOUS
// name, resolved from the row itself (never from a caller-supplied "old name")
// -- see construction-boq-category-service.ts's header for why. A delete of a
// category still in use is refused with "Used by N BOQ lines" (409), never a
// cascade and never a silent re-categorisation.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { renameBoqCategory, deleteBoqCategory, ServiceError } from "@/lib/services/construction-boq-category-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await renameBoqCategory({ orgId: ctx.orgId }, id, body?.name)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ category rename error:", error)
    return NextResponse.json({ error: "Failed to rename BOQ category" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const retired = await deleteBoqCategory({ orgId: ctx.orgId }, id)
    return NextResponse.json(retired)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ category delete error:", error)
    return NextResponse.json({ error: "Failed to delete BOQ category" }, { status: 500 })
  }
}
