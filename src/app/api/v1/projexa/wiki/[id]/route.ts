// Priority 17 Wave 1: thin alias over pms-wiki-service.ts's
// updateWikiPage(). No requirePmsEnabled() gate -- see ../route.ts header.
// Real-screen conversion (2026-08-30): GET added -- getWikiPage() didn't
// exist before (single-item read for the Wiki Object Page).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getWikiPage, updateWikiPage, ServiceError } from "@/lib/services/pms-wiki-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const page = await getWikiPage({ orgId: ctx.orgId }, id)
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa wiki get error:", error)
    return NextResponse.json({ error: "Failed to fetch wiki page" }, { status: 500 })
  }
}

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
    const result = await updateWikiPage({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa wiki update error:", error)
    return NextResponse.json({ error: "Failed to update wiki page" }, { status: 500 })
  }
}
