// Priority 15 (PROJEXA HR & Payroll, full-depth pass): admin-gated, explicit
// link from a 'hired' application to an already-created employeeProfiles
// row -- recruitment-service.ts's linkHiredEmployee never auto-provisions
// the profile itself (same "no silent auto-provisioning" discipline as
// Wave 59's SSO).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { linkHiredEmployee, ServiceError } from "@/lib/services/recruitment-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "admin", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await params
    const body = await request.json()
    const updated = await linkHiredEmployee({ orgId: ctx.orgId, userId: actorId }, id, body.employeeProfileId)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa hire link error:", error)
    return NextResponse.json({ error: "Failed to link hired employee" }, { status: 500 })
  }
}
