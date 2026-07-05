import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitPurchaseRequisition, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const req_ = await submitPurchaseRequisition({ orgId, userId: dbUser.id, dbUser }, id)

    if (!req_.pendingApproval) {
      try {
        const { deliverWebhook } = await import("@/lib/webhook-deliver")
        await deliverWebhook(orgId, "erp_purchase_requisition.approved", { requisitionId: id })
      } catch (webhookError) {
        console.error("Webhook delivery error (non-fatal):", webhookError)
      }
    }

    return NextResponse.json(req_)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase requisition submit error:", error)
    return NextResponse.json({ error: "Failed to submit purchase requisition" }, { status: 500 })
  }
}
