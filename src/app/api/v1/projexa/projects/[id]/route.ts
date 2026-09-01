import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateProjectValue, ServiceError } from "@/lib/services/construction-dashboard-service"

// Point 121: PATCH { projectValue }. Only projectValue is handled here --
// no other project field editing is in scope for this point.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body.projectValue !== undefined && body.projectValue !== null && typeof body.projectValue !== "number") {
      return NextResponse.json({ error: "projectValue must be a number or null" }, { status: 400 })
    }
    const project = await updateProjectValue({ orgId: ctx.orgId }, id, body.projectValue ?? null)
    return NextResponse.json(project)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project value update error:", error)
    return NextResponse.json({ error: "Failed to update project value" }, { status: 500 })
  }
}
