import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listFfeItems, createFfeItem, ServiceError } from "@/lib/services/interior-design-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const roomOrArea = request.nextUrl.searchParams.get("roomOrArea") ?? undefined
  const status = request.nextUrl.searchParams.get("status") ?? undefined

  try {
    const items = await listFfeItems({ orgId: ctx.orgId }, projectId, { roomOrArea, status })
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa ffe list error:", error)
    return NextResponse.json({ error: "Failed to list FF&E items" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    const item = await createFfeItem({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa ffe create error:", error)
    return NextResponse.json({ error: "Failed to create FF&E item" }, { status: 500 })
  }
}
