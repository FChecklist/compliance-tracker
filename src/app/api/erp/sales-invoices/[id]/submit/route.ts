import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitSalesInvoice, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const invoice = await submitSalesInvoice({ orgId, userId: dbUser.id, dbUser }, id, body)

    try {
      const { deliverWebhook } = await import("@/lib/webhook-deliver")
      await deliverWebhook(orgId, "erp_sales_invoice.submitted", { invoiceId: id, grandTotal: invoice.grandTotal })
    } catch (webhookError) {
      console.error("Webhook delivery error (non-fatal):", webhookError)
    }

    return NextResponse.json(invoice)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales invoice submit error:", error)
    return NextResponse.json({ error: "Failed to submit sales invoice" }, { status: 500 })
  }
}
