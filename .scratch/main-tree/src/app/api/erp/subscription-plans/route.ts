import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listSubscriptionPlans, createSubscriptionPlan, ServiceError } from "@/lib/services/erp-contract-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ plans: [] })

  try {
    const plans = await listSubscriptionPlans({ orgId })
    return NextResponse.json({ plans })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Subscription plans list error:", error)
    return NextResponse.json({ error: "Failed to fetch subscription plans" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const plan = await createSubscriptionPlan({ orgId }, body)
    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Subscription plan create error:", error)
    return NextResponse.json({ error: "Failed to create subscription plan" }, { status: 500 })
  }
}
