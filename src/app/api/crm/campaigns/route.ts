import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createCampaign, listCampaigns, ServiceError } from "@/lib/services/crm-campaigns-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json([])

  try {
    const campaigns = await listCampaigns({ orgId })
    return NextResponse.json(campaigns)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM campaigns list error:", error)
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const campaign = await createCampaign({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM campaign create error:", error)
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 })
  }
}
