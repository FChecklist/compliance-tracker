import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCycleCountPlans, createCycleCountPlan, ServiceError } from "@/lib/services/erp-inventory-planning-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ plans: [] })

  try {
    const plans = await listCycleCountPlans({ orgId })
    return NextResponse.json({ plans })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cycle count plans list error:", error)
    return NextResponse.json({ error: "Failed to fetch cycle count plans" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: routine planning data entry
  const roleErr = requirePermissionForUser(dbUser, "erp.inventory.cycle_count_plan")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const plan = await createCycleCountPlan({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cycle count plan create error:", error)
    return NextResponse.json({ error: "Failed to create cycle count plan" }, { status: 500 })
  }
}
