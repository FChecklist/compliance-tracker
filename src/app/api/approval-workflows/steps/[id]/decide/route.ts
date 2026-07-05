import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { decideApprovalStep, ServiceError } from "@/lib/services/approval-workflow-service"
import { markJournalEntrySubmittedFromApproval } from "@/lib/services/erp-accounting-service"
import { markPurchaseRequisitionApprovedFromApproval } from "@/lib/services/erp-procurement-workflow-service"

// Entity-specific "on approved" dispatch, kept at the route layer rather
// than inside the generic engine so approval-workflow-service.ts stays
// entity-agnostic -- any future module that adopts this engine adds one
// case here, not a new branch inside the shared service. Wave 55 added the
// second real consumer (erp_purchase_requisition) to prove this generalizes.
async function onWorkflowApproved(ctx: { orgId: string; userId: string; dbUser: Parameters<typeof markJournalEntrySubmittedFromApproval>[0]['dbUser'] }, entityType: string, entityId: string) {
  if (entityType === "erp_journal_entry") {
    await markJournalEntrySubmittedFromApproval(ctx, entityId)
  } else if (entityType === "erp_purchase_requisition") {
    await markPurchaseRequisitionApprovedFromApproval(ctx, entityId)
  }

  // Wave 58: fire an ERP webhook once the workflow-gated entity actually
  // finalizes, mirroring the same-event no-workflow-configured path.
  try {
    const { deliverWebhook } = await import("@/lib/webhook-deliver")
    if (entityType === "erp_journal_entry") await deliverWebhook(ctx.orgId, "erp_journal_entry.submitted", { journalEntryId: entityId })
    else if (entityType === "erp_purchase_requisition") await deliverWebhook(ctx.orgId, "erp_purchase_requisition.approved", { requisitionId: entityId })
  } catch (webhookError) {
    console.error("Webhook delivery error (non-fatal):", webhookError)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const { decision, comment } = await request.json()
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
    }

    const result = await decideApprovalStep({ orgId, userId: dbUser.id, dbUser }, id, decision, comment)

    if (result.instanceStatus === "approved") {
      await onWorkflowApproved({ orgId, userId: dbUser.id, dbUser }, result.entityType, result.entityId)
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Approval decision error:", error)
    return NextResponse.json({ error: "Failed to record approval decision" }, { status: 500 })
  }
}
