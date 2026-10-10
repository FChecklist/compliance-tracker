// Priority 15 (PROJEXA HR & Payroll, Wave 1): job-opening status update
// (open / on_hold / closed / filled).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { updateJobOpeningStatus, ServiceError } from "@/lib/services/recruitment-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError
  const actorId = acting.person.id

  try {
    const { id } = await params
    const body = await request.json()
    const updated = await updateJobOpeningStatus({ orgId: ctx.orgId, userId: actorId }, id, body.status)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa job opening status update error:", error)
    return NextResponse.json({ error: "Failed to update job opening status" }, { status: 500 })
  }
}
