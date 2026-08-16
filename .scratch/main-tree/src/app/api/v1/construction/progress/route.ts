import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listProgressEntries, createProgressEntry, ServiceError } from "@/lib/services/construction-progress-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ entries: [] })

  try {
    const entries = await listProgressEntries({ orgId: ctx.orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      activityId: request.nextUrl.searchParams.get("activityId") ?? undefined,
    })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress list error:", error)
    return NextResponse.json({ error: "Failed to fetch progress entries" }, { status: 500 })
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
    const result = await createProgressEntry({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress entry create error:", error)
    return NextResponse.json({ error: "Failed to create progress entry" }, { status: 500 })
  }
}
