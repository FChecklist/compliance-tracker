import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { computeQualityScores, ServiceError } from "@/lib/services/mdm-quality-service"

export async function GET(request: Request) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ scores: [] })

  try {
    const { searchParams } = new URL(request.url)
    const entityType = searchParams.get("entityType") ?? "erp_customer"
    const scores = await computeQualityScores({ orgId }, entityType)
    return NextResponse.json({ scores })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("MDM quality scores fetch error:", error)
    return NextResponse.json({ error: "Failed to compute quality scores" }, { status: 500 })
  }
}
