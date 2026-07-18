import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateRiskLinkedControls, ServiceError } from "@/lib/services/risk-register-service"

type RouteContext = { params: Promise<{ id: string }> }

// VERIDIAN Review Framework gap-closure (Policy Compliance Verification):
// the ONLY writer of risks.linked_control_ids -- without this route, the
// evidence chain hasVerificationEvidence() (risk-register-service.ts) needs
// to move a framework_control to 'verified' can never be satisfied by
// anyone, ever (confirmed by grep before adding this: the column existed
// and was read, but nothing wrote it past its []-default).
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await context.params
  let body: { controlIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const controlIds = Array.isArray(body.controlIds) ? body.controlIds.filter((c): c is string => typeof c === "string") : []

  try {
    const updated = await updateRiskLinkedControls({ orgId, userId: dbUser.id, dbUser }, id, controlIds)
    return NextResponse.json({ id: updated.id, linkedControlIds: updated.linkedControlIds })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Risk linked-controls update error:", error)
    return NextResponse.json({ error: "Failed to update linked controls" }, { status: 500 })
  }
}
