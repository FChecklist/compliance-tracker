// Priority 15 (PROJEXA Invoicing module, full lifecycle): thin ALIASING
// route over erp-invoicing-service.ts's cancelSalesInvoice -- draft
// invoices only (see that function's own comment for why a submitted
// invoice needs a reversing credit note instead of a direct cancel).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { cancelSalesInvoice, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const updated = await cancelSalesInvoice({ orgId: ctx.orgId, userId: actorId }, id)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-invoice cancel error:", error)
    return NextResponse.json({ error: "Failed to cancel invoice" }, { status: 500 })
  }
}
