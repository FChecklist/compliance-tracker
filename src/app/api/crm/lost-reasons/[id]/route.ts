import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { deactivateLostReason, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

// Deactivate only -- this org-configurable picklist has no other mutable
// field (reasonText is set once at creation) and no hard delete, since
// existing crm_opportunities.lost_reason_id rows may already reference it
// (soft-deactivate keeps historical opportunities' reason readable while
// removing it from future pick-lists, same rationale as isActive flags
// elsewhere in this schema).
export async function PATCH(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // R75 Part 2 G2 gap-closure (2026-09-05): same gate as POST /api/crm/lost-reasons.
  const permissionDenied = requirePermissionForUser(dbUser, "crm.lost_reasons.manage")
  if (permissionDenied) return permissionDenied

  try {
    const { id } = await params
    const reason = await deactivateLostReason({ orgId }, id)
    return NextResponse.json(reason)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lost reason deactivate error:", error)
    return NextResponse.json({ error: "Failed to deactivate lost reason" }, { status: 500 })
  }
}
