// Real-screen conversion (2026-08-30): single-invoice GET for the PROJEXA
// Invoicing Object Page -- mirrors sales-invoices/route.ts's own
// toInvoiceShape so the list and Object Page always agree on field names.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getSalesInvoice, ServiceError } from "@/lib/services/erp-invoicing-service"

function toInvoiceShape(inv: Awaited<ReturnType<typeof getSalesInvoice>>) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerId: inv.customerId,
    customerName: inv.customer?.customerName ?? null,
    salesOrderId: inv.salesOrderId,
    projectId: inv.projectId,
    postingDate: inv.postingDate,
    dueDate: inv.dueDate,
    subtotal: inv.subtotal,
    taxAmount: inv.taxAmount,
    grandTotal: inv.grandTotal,
    outstandingAmount: inv.outstandingAmount,
    status: inv.status,
    items: inv.items?.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, rate: i.rate, amount: i.amount, hsnSacCode: i.hsnSacCode })) ?? [],
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
    const invoice = await getSalesInvoice({ orgId: ctx.orgId }, id)
    return NextResponse.json(toInvoiceShape(invoice))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-invoice get error:", error)
    return NextResponse.json({ error: "Failed to fetch sales invoice" }, { status: 500 })
  }
}
