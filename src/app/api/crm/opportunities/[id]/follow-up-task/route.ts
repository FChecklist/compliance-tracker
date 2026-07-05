import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createFollowUpTaskFromOpportunity, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await createFollowUpTaskFromOpportunity({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM opportunity follow-up task error:", error)
    return NextResponse.json({ error: "Failed to create follow-up task" }, { status: 500 })
  }
}
