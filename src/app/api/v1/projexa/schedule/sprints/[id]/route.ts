// Priority 17 Wave 1: thin alias over pms-sprint-service.ts's
// updateSprint()/closeSprint(). No requirePmsEnabled() gate -- see
// ../route.ts header for the full reasoning (matches meetings/schedule/
// board precedent).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateSprint, closeSprint, ServiceError } from "@/lib/services/pms-sprint-service"

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
    const result = body?.action === "close" ? await closeSprint({ orgId: ctx.orgId }, id) : await updateSprint({ orgId: ctx.orgId }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sprint update error:", error)
    return NextResponse.json({ error: "Failed to update sprint" }, { status: 500 })
  }
}
