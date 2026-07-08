import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSuppliers, createSupplier, ServiceError } from "@/lib/services/erp-buying-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ suppliers: [] })

  try {
    const suppliers = await listSuppliers({ orgId })
    return NextResponse.json({ suppliers })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Suppliers list error:", error)
    return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const supplier = await createSupplier({ orgId }, body)
    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier create error:", error)
    return NextResponse.json({ error: "Failed to create supplier" }, { status: 500 })
  }
}
