// Priority 15 (PROJEXA HR & Payroll, full-depth pass): interviewer feedback
// submission (rating + recommendation) via recruitment-service.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { submitInterviewFeedback, ServiceError } from "@/lib/services/recruitment-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError
  const actorId = acting.person.id

  try {
    const { id } = await params
    const body = await request.json()
    const updated = await submitInterviewFeedback({ orgId: ctx.orgId, userId: actorId }, id, body)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa interview feedback error:", error)
    return NextResponse.json({ error: "Failed to submit interview feedback" }, { status: 500 })
  }
}
