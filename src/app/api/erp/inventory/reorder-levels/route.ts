import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listReorderLevels, setReorderLevel, ServiceError } from "@/lib/services/erp-inventory-planning-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ reorderLevels: [] })

  try {
    const reorderLevels = await listReorderLevels({ orgId })
    return NextResponse.json({ reorderLevels })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Reorder levels list error:", error)
    return NextResponse.json({ error: "Failed to fetch reorder levels" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: routine planning configuration
  const roleErr = requirePermissionForUser(dbUser, "erp.inventory.reorder_level")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const level = await setReorderLevel({ orgId }, body.itemId, body.warehouseId, body)
    return NextResponse.json(level, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Reorder level set error:", error)
    return NextResponse.json({ error: "Failed to set reorder level" }, { status: 500 })
  }
}
