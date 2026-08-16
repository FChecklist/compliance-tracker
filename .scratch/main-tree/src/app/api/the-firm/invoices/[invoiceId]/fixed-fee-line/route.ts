import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { addFixedFeeLineToInvoice, ServiceError } from "@/lib/services/firm-billing-service"

export async function POST(req: NextRequest, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { invoiceId } = await ctx.params
    const body = await req.json()
    const lineItem = await addFixedFeeLineToInvoice({ orgId, userId: dbUser.id, dbUser }, invoiceId, body)
    return NextResponse.json(lineItem, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Add fixed fee line error:", error)
    return NextResponse.json({ error: "Failed to add fixed fee line" }, { status: 500 })
  }
}
