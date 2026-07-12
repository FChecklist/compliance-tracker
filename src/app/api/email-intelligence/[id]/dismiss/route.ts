import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { dismissEmailIntelligenceItem, ServiceError } from "@/lib/services/email-intelligence-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await dismissEmailIntelligenceItem({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Email intelligence dismiss error:", error)
    return NextResponse.json({ error: "Failed to dismiss email intelligence item" }, { status: 500 })
  }
}
