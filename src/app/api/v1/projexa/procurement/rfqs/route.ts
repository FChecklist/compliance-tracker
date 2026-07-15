// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// erp-procurement-workflow-service.ts's listRfqs/createRfq -- stage 2 of
// the requisition -> RFQ -> quotation -> negotiation -> PO -> goods-receipt
// workflow. An RFQ can be raised directly or linked to a prior requisition
// (requisitionId is optional, matching the service's own schema comment).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listRfqs, createRfq, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ rfqs: [] })

  try {
    const rfqs = await listRfqs({ orgId: ctx.orgId })
    return NextResponse.json({ rfqs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement rfqs list error:", error)
    return NextResponse.json({ error: "Failed to fetch RFQs" }, { status: 500 })
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
    if (!body.supplierIds?.length) return NextResponse.json({ error: "At least one supplier is required" }, { status: 400 })
    if (!body.postingDate) return NextResponse.json({ error: "postingDate is required" }, { status: 400 })
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const rfq = await createRfq(actorCtx, {
      requisitionId: body.requisitionId, postingDate: body.postingDate, items: body.items, supplierIds: body.supplierIds,
    })
    return NextResponse.json(rfq, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement rfq create error:", error)
    return NextResponse.json({ error: "Failed to create RFQ" }, { status: 500 })
  }
}
