import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getNotice, updateNotice, deleteNotice, ServiceError } from "@/lib/services/notice-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const result = await getNotice({ orgId: ctx.orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 notice detail error:", error)
    return NextResponse.json({ error: "Failed to fetch notice" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "viewer", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const result = await updateNotice(
      { orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, request },
      id, body
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 notice update error:", error)
    return NextResponse.json({ error: "Failed to update notice" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "viewer", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const result = await deleteNotice(
      { orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, request },
      id
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 notice delete error:", error)
    return NextResponse.json({ error: "Failed to delete notice" }, { status: 500 })
  }
}
