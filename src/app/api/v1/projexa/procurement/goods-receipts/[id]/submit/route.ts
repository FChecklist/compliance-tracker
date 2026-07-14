// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// submitPurchaseReceipt -- posts real FIFO stock (recordStockReceipt) for
// every line item and rolls the parent PO's status up to
// partially_received/completed. The final step in the requisition -> RFQ ->
// quotation -> negotiation -> PO -> goods-receipt workflow.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitPurchaseReceipt, ServiceError } from "@/lib/services/erp-goods-receipt-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const receipt = await submitPurchaseReceipt(actorCtx, id)
    return NextResponse.json(receipt)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement goods-receipt submit error:", error)
    return NextResponse.json({ error: "Failed to submit goods receipt" }, { status: 500 })
  }
}
