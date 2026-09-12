import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { promoteEmailIntelligenceItem, ServiceError } from "@/lib/services/email-intelligence-service"

type RouteContext = { params: Promise<{ id: string }> }

// Human-gated by construction: a suggested work item only becomes a real
// task via this explicit call, never automatically from analysis itself
// (U-D21.B1.S1: "No object created without approval").
//
// R75 Part 2 Phase 5 (G3-email-conv): "human-gated" above only ever meant
// "not fully automatic" -- there was NO role/rank gate at all beyond
// requireAuth(), so any authenticated org member could promote a suggestion
// into a real `tasks` row. This creates exactly the kind of object POST
// /api/tasks creates directly, and that route already requires
// requireRoleOrScope(ctx, "member") -- matched here at the same rank for
// the same action, just reached via a different entry point.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await promoteEmailIntelligenceItem({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Email intelligence promote error:", error)
    return NextResponse.json({ error: "Failed to promote email intelligence item" }, { status: 500 })
  }
}
