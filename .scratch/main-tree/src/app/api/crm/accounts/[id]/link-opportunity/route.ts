import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { linkOpportunityToAccount, ServiceError } from "@/lib/services/crm-accounts-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.opportunityId) return NextResponse.json({ error: "opportunityId is required" }, { status: 400 })
    const opportunity = await linkOpportunityToAccount({ orgId, userId: dbUser.id, dbUser }, body.opportunityId, id)
    return NextResponse.json(opportunity)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM account link-opportunity error:", error)
    return NextResponse.json({ error: "Failed to link opportunity" }, { status: 500 })
  }
}
