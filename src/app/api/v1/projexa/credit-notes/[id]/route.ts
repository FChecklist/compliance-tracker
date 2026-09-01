// Real-screen conversion (2026-08-30): single-credit-note GET for the
// PROJEXA Invoicing Object Page -- mirrors credit-notes/route.ts's own
// toCreditNoteShape, extended with items (that list route never needed
// them).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getSalesCreditNote, ServiceError } from "@/lib/services/erp-credit-note-service"

function toCreditNoteShape(n: Awaited<ReturnType<typeof getSalesCreditNote>>) {
  return {
    id: n.id, creditNoteNumber: n.creditNoteNumber, customerId: n.customerId, customerName: n.customer?.customerName ?? null,
    salesInvoiceId: n.salesInvoiceId, postingDate: n.postingDate, reason: n.reason, status: n.status, totalAmount: n.totalAmount,
    items: n.items?.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, rate: i.rate, amount: i.amount })) ?? [],
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const note = await getSalesCreditNote({ orgId: ctx.orgId }, id)
    return NextResponse.json(toCreditNoteShape(note))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa credit-note get error:", error)
    return NextResponse.json({ error: "Failed to fetch credit note" }, { status: 500 })
  }
}
