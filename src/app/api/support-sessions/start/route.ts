import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { startSupportSession } from "@/lib/services/support-session-service"
import { ServiceError } from "@/lib/services/compliance-service"

// Only a veridian_admin (ROLE_RANK 6, the platform's own top role) may start
// a support session against ANY org -- this is deliberately not gated by
// the caller's own orgId the way every other route in this codebase is,
// since the entire point is acting on behalf of a DIFFERENT org's customer.
export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  const roleError = requireRole(dbUser, "veridian_admin")
  if (roleError) return roleError

  try {
    const body = await request.json()
    const targetOrgId = typeof body.targetOrgId === "string" ? body.targetOrgId.trim() : ""
    const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : ""
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!targetOrgId || !targetUserId || !reason) {
      return NextResponse.json({ error: "targetOrgId, targetUserId, and reason are all required" }, { status: 400 })
    }

    const result = await startSupportSession({ initiatedBy: dbUser, targetOrgId, targetUserId, reason })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Support session start error:", error)
    return NextResponse.json({ error: "Failed to start support session" }, { status: 500 })
  }
}
