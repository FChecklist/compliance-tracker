import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSiteDiaries, createSiteDiary, ServiceError } from "@/lib/services/construction-site-diary-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ diaries: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const diaries = await listSiteDiaries({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ diaries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site diary list error:", error)
    return NextResponse.json({ error: "Failed to fetch site diaries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await createSiteDiary({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site diary create error:", error)
    return NextResponse.json({ error: "Failed to create site diary entry" }, { status: 500 })
  }
}
