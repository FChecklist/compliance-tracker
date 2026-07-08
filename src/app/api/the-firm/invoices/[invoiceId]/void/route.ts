import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { voidInvoice, ServiceError } from "@/lib/services/firm-billing-service"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { invoiceId } = await ctx.params
    const invoice = await voidInvoice({ orgId }, invoiceId)
    return NextResponse.json(invoice)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Void invoice error:", error)
    return NextResponse.json({ error: "Failed to void invoice" }, { status: 500 })
  }
}
