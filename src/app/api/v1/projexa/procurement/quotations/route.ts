// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// erp-procurement-workflow-service.ts's listSupplierQuotations/
// createSupplierQuotation -- stage 3 of the workflow (a supplier's response
// to an RFQ). Distinct from PROJEXA's existing /v1/projexa/quotations
// route, which aliases erp-selling-service.ts's customer-facing SALES
// quotations (a different table, a different direction of the deal) --
// this is a SUPPLIER quotation received in response to an RFQ.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSupplierQuotations, createSupplierQuotation, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ quotations: [] })

  try {
    const rfqId = request.nextUrl.searchParams.get("rfqId") ?? undefined
    const quotations = await listSupplierQuotations({ orgId: ctx.orgId }, rfqId)
    return NextResponse.json({ quotations })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement quotations list error:", error)
    return NextResponse.json({ error: "Failed to fetch supplier quotations" }, { status: 500 })
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
    if (!body.supplierId) return NextResponse.json({ error: "supplierId is required" }, { status: 400 })
    if (!body.items?.length) return NextResponse.json({ error: "At least one line item is required" }, { status: 400 })
    if (!body.postingDate) return NextResponse.json({ error: "postingDate is required" }, { status: 400 })
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const quotation = await createSupplierQuotation(actorCtx, {
      rfqId: body.rfqId, supplierId: body.supplierId, postingDate: body.postingDate, validTill: body.validTill, items: body.items,
    })
    return NextResponse.json(quotation, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement quotation create error:", error)
    return NextResponse.json({ error: "Failed to create supplier quotation" }, { status: 500 })
  }
}
