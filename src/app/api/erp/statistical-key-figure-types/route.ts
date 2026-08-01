// CO-006 (Statistical Key Figure Report) master-data route -- direct
// template: src/app/api/erp/cost-centers/route.ts.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listStatisticalKeyFigureTypes, createStatisticalKeyFigureType, ServiceError } from "@/lib/services/erp-costing-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ statisticalKeyFigureTypes: [] })

  try {
    const statisticalKeyFigureTypes = await listStatisticalKeyFigureTypes({ orgId })
    return NextResponse.json({ statisticalKeyFigureTypes })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Statistical key figure types list error:", error)
    return NextResponse.json({ error: "Failed to fetch statistical key figure types" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.statistical_key_figure_types.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const statKeyFigureType = await createStatisticalKeyFigureType({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(statKeyFigureType, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Statistical key figure type create error:", error)
    return NextResponse.json({ error: "Failed to create statistical key figure type" }, { status: 500 })
  }
}
