import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listBusinessRules, createBusinessRule, ServiceError } from "@/lib/services/business-rules-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rules: [] })

  try {
    const { searchParams } = new URL(request.url)
    const moduleKey = searchParams.get("moduleKey") || undefined
    const status = searchParams.get("status") || undefined
    const rules = await listBusinessRules({ orgId }, { moduleKey, status })
    return NextResponse.json({ rules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business rules list error:", error)
    return NextResponse.json({ error: "Failed to fetch business rules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createBusinessRule({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business rule create error:", error)
    return NextResponse.json({ error: "Failed to create business rule" }, { status: 500 })
  }
}
