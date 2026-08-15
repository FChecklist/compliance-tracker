import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listBusinessRuleVersions, ServiceError } from "@/lib/services/business-rules-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const versions = await listBusinessRuleVersions({ orgId }, id)
    return NextResponse.json({ versions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business rule versions list error:", error)
    return NextResponse.json({ error: "Failed to fetch business rule versions" }, { status: 500 })
  }
}
