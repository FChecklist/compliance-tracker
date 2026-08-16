import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBaselines, captureBaseline, ServiceError } from "@/lib/services/schedule-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const baselines = await listBaselines({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ baselines })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule baselines list error:", error)
    return NextResponse.json({ error: "Failed to list baselines" }, { status: 500 })
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
    if (!body.projectId || !body.name) return NextResponse.json({ error: "projectId and name are required" }, { status: 400 })
    const baseline = await captureBaseline({ orgId: ctx.orgId, userId: actorId }, body.projectId, body.name)
    return NextResponse.json(baseline, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule baseline capture error:", error)
    return NextResponse.json({ error: "Failed to capture baseline" }, { status: 500 })
  }
}
