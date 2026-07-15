// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// erp-procurement-workflow-service.ts's listPurchaseRequisitions/
// createPurchaseRequisition -- stage 1 of the requisition -> RFQ ->
// quotation -> negotiation -> PO -> goods-receipt workflow. Distinct from
// PROJEXA's pre-existing "Vendors" page, which only ever exposed
// erp-buying-service.ts's supplier master data with no upstream
// authorization trail.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listPurchaseRequisitions, createPurchaseRequisition, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ requisitions: [] })

  try {
    const requisitions = await listPurchaseRequisitions({ orgId: ctx.orgId })
    return NextResponse.json({ requisitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement requisitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase requisitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!body.items?.length) return NextResponse.json({ error: "At least one line item is required" }, { status: 400 })
    if (!body.postingDate) return NextResponse.json({ error: "postingDate is required" }, { status: 400 })
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const requisition = await createPurchaseRequisition(actorCtx, {
      departmentId: body.departmentId, purpose: body.purpose, postingDate: body.postingDate, items: body.items,
    })
    return NextResponse.json(requisition, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement requisition create error:", error)
    return NextResponse.json({ error: "Failed to create purchase requisition" }, { status: 500 })
  }
}
