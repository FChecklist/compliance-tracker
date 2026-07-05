import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPricingRules, createPricingRule, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rules: [] })

  try {
    const rules = await listPricingRules({ orgId })
    return NextResponse.json({ rules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pricing rules list error:", error)
    return NextResponse.json({ error: "Failed to fetch pricing rules" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const rule = await createPricingRule({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(rule, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pricing rule create error:", error)
    return NextResponse.json({ error: "Failed to create pricing rule" }, { status: 500 })
  }
}
