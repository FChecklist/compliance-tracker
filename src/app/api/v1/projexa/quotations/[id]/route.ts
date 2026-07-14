// Priority 15 (Sales & CRM depth wave): status-update alias over
// erp-selling-service.ts's updateQuotationStatus, which now enforces a real
// draft -> pending_approval -> approved -> sent -> ordered|lost|expired
// transition table (see that function's own comment) instead of a
// free-for-all setter. Quote->sales-order conversion lives at the sibling
// [id]/convert/route.ts; revisioning at [id]/revisions/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateQuotationStatus, ServiceError } from "@/lib/services/erp-selling-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 })
    const quotation = await updateQuotationStatus({ orgId: ctx.orgId, userId: actorId }, id, body.status)
    return NextResponse.json({ id: quotation.id, quotationNumber: quotation.quotationNumber, status: quotation.status })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotation update error:", error)
    return NextResponse.json({ error: "Failed to update quotation" }, { status: 500 })
  }
}
