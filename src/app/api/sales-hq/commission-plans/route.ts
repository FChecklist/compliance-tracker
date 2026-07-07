import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createOrUpdateCommissionPlan, listCommissionPlans, ServiceError } from "@/lib/services/sales-engine-service"

export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const plans = await listCommissionPlans({ dbUser })
    return NextResponse.json({ plans })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Commission plans list error:", error)
    return NextResponse.json({ error: "Failed to fetch commission plans" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const body = await request.json()
    const plan = await createOrUpdateCommissionPlan({ dbUser }, body)
    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Commission plan create error:", error)
    return NextResponse.json({ error: "Failed to create commission plan" }, { status: 500 })
  }
}
