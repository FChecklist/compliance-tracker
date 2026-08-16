import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCustomers, createCustomer, ServiceError } from "@/lib/services/erp-selling-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ customers: [] })

  try {
    const customers = await listCustomers({ orgId })
    return NextResponse.json({ customers })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Customers list error:", error)
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const customer = await createCustomer({ orgId }, body)
    return NextResponse.json(customer, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Customer create error:", error)
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 })
  }
}
