import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPurchaseInvoices, createPurchaseInvoice, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ invoices: [] })

  try {
    const invoices = await listPurchaseInvoices({ orgId })
    return NextResponse.json({ invoices })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase invoices list error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase invoices" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const invoice = await createPurchaseInvoice({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase invoice create error:", error)
    return NextResponse.json({ error: "Failed to create purchase invoice" }, { status: 500 })
  }
}
