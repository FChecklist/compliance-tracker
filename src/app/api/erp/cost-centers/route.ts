import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCostCenters, createCostCenter, ServiceError } from "@/lib/services/erp-accounting-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ costCenters: [] })

  try {
    const costCenters = await listCostCenters({ orgId })
    return NextResponse.json({ costCenters })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cost centers list error:", error)
    return NextResponse.json({ error: "Failed to fetch cost centers" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: routine reference data entry
  const roleErr = requirePermissionForUser(dbUser, "erp.cost_centers.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const costCenter = await createCostCenter({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(costCenter, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cost center create error:", error)
    return NextResponse.json({ error: "Failed to create cost center" }, { status: 500 })
  }
}
