import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listOpportunities, createOpportunity, ServiceError } from "@/lib/services/crm-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ opportunities: [] })

  try {
    const opportunities = await listOpportunities({ orgId })
    return NextResponse.json({ opportunities })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM opportunities list error:", error)
    return NextResponse.json({ error: "Failed to fetch opportunities" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const opportunity = await createOpportunity({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(opportunity, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM opportunity create error:", error)
    return NextResponse.json({ error: "Failed to create opportunity" }, { status: 500 })
  }
}
