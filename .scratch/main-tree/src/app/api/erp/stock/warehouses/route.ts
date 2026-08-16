import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listWarehouses, createWarehouse, ServiceError } from "@/lib/services/erp-stock-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ warehouses: [] })

  try {
    const warehouses = await listWarehouses({ orgId })
    return NextResponse.json({ warehouses })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Warehouses list error:", error)
    return NextResponse.json({ error: "Failed to fetch warehouses" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const warehouse = await createWarehouse({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(warehouse, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Warehouse create error:", error)
    return NextResponse.json({ error: "Failed to create warehouse" }, { status: 500 })
  }
}
