import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { setAbacPolicyActive, ServiceError } from "@/lib/services/abac-policy-service"

/** Enable/disable a policy -- the only mutation exposed after creation. Conditions/resourceType/action are immutable once created (delete + recreate for a real change) to keep every policy's history unambiguous in audit_logs, matching this codebase's existing preference for append-only-ish config over silent in-place edits of security-relevant rows. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive (boolean) is required" }, { status: 400 })
    }
    const policy = await setAbacPolicyActive({ orgId, userId: dbUser.id, dbUser }, id, body.isActive)
    return NextResponse.json(policy)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("ABAC policy update error:", error)
    return NextResponse.json({ error: "Failed to update ABAC policy" }, { status: 500 })
  }
}
