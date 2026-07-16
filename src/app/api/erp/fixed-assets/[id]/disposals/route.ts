import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listAssetDisposals, initiateAssetDisposal, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const disposals = await listAssetDisposals({ orgId }, id)
    return NextResponse.json({ disposals })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset disposals list error:", error)
    return NextResponse.json({ error: "Failed to fetch asset disposals" }, { status: 500 })
  }
}

// Owner's brief: disposal requires "a real authenticated user at manager
// rank or above, not just an API key" -- matches
// src/app/api/documents/[id]/dispose/route.ts's own identical gate exactly
// (requireRole(dbUser, "manager") immediately after requireAuth). Whether
// an *additional* org-configured approval-workflow sign-off is also needed
// on top of this route-level gate is decided by initiateAssetDisposal
// itself (startApprovalWorkflow), same as submitJournalEntry/
// submitPurchaseRequisition's own "no workflow configured -> auto-approve"
// precedent -- this gate is the floor, not a replacement for that engine.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await initiateAssetDisposal({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset disposal initiate error:", error)
    return NextResponse.json({ error: "Failed to initiate asset disposal" }, { status: 500 })
  }
}
