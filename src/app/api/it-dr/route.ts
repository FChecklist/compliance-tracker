import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listDrPlans, createDrPlan, ServiceError } from "@/lib/services/it-dr-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ plans: [] })

  const plans = await listDrPlans({ orgId })
  return NextResponse.json({ plans })
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const plan = await createDrPlan({ orgId }, body)
    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("DR plan create error:", error)
    return NextResponse.json({ error: "Failed to create DR plan" }, { status: 500 })
  }
}
