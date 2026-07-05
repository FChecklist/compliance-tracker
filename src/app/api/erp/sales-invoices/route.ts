import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSalesInvoices, createSalesInvoice, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ invoices: [] })

  try {
    const invoices = await listSalesInvoices({ orgId })
    return NextResponse.json({ invoices })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales invoices list error:", error)
    return NextResponse.json({ error: "Failed to fetch sales invoices" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const invoice = await createSalesInvoice({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales invoice create error:", error)
    return NextResponse.json({ error: "Failed to create sales invoice" }, { status: 500 })
  }
}
