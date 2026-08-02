// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// submitPurchaseRequisition, which starts a real Approval Workflow Engine
// instance if the org has one configured for 'erp_purchase_requisition'
// (see approval-workflow-service.ts) -- otherwise auto-approves, matching
// submitJournalEntry's own no-approval-configured default. Deliberately
// requires a real per-user session, not PROJEXA's shared API key:
// startApprovalWorkflow's WorkflowContext needs a real dbUser to attribute
// the workflow instance to, the same "requires a real session" precedent
// already used for the quotation approval transition
// (quotations/[id]/route.ts) and leave-request/payroll decisions elsewhere
// in this codebase. Honest limitation, not a regression: PROJEXA's shared-
// API-key proxy has no per-user identity bridge to VERIDIAN today, so this
// route returns 400 for every API-key caller until that bridge exists.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitPurchaseRequisition, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) {
    return NextResponse.json({ error: "Submitting a purchase requisition requires a real user session, not an API key" }, { status: 400 })
  }

  try {
    const { id } = await params
    const requisition = await submitPurchaseRequisition({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id)
    return NextResponse.json(requisition)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement requisition submit error:", error)
    return NextResponse.json({ error: "Failed to submit purchase requisition" }, { status: 500 })
  }
}
