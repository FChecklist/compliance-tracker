import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateInvoiceFromUnbilledTime, listInvoicesForClient, ServiceError } from "@/lib/services/firm-billing-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const invoices = await listInvoicesForClient({ orgId }, clientId)
    return NextResponse.json({ invoices })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List invoices error:", error)
    return NextResponse.json({ error: "Failed to list invoices" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { clientId } = await ctx.params
    const body = await req.json()
    const invoice = await generateInvoiceFromUnbilledTime({ orgId, userId: dbUser.id }, { ...body, clientId })
    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Generate invoice error:", error)
    return NextResponse.json({ error: "Failed to generate invoice" }, { status: 500 })
  }
}
