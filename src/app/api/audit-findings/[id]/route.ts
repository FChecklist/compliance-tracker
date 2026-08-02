import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { advanceAuditFindingCapaStatus, ServiceError } from "@/lib/services/risk-register-service"

type RouteContext = { params: Promise<{ id: string }> }

// Priority 15: logic extracted verbatim into risk-register-service.ts so
// PROJEXA's /api/v1/projexa/audit-findings/[id] alias can call the exact
// same implementation instead of duplicating it.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const updated = await advanceAuditFindingCapaStatus({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json({ id: updated.id, capaStatus: updated.capaStatus })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Audit finding PATCH error:", error)
    return NextResponse.json({ error: "Failed to update audit finding" }, { status: 500 })
  }
}
