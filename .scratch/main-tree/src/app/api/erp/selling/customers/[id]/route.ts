import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateCustomer, ServiceError } from "@/lib/services/erp-selling-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const customer = await updateCustomer({ orgId }, id, body)
    return NextResponse.json(customer)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Customer update error:", error)
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 })
  }
}
