import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSubmittals, createSubmittal, ServiceError } from "@/lib/services/construction-field-workflow-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const status = request.nextUrl.searchParams.get("status") ?? undefined

  try {
    const submittals = await listSubmittals({ orgId: ctx.orgId }, projectId, { status })
    return NextResponse.json({ submittals })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa submittals list error:", error)
    return NextResponse.json({ error: "Failed to list submittals" }, { status: 500 })
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
    const submittal = await createSubmittal({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(submittal, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa submittals create error:", error)
    return NextResponse.json({ error: "Failed to create submittal" }, { status: 500 })
  }
}
