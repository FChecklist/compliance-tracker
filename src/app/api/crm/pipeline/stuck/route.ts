import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listStuckOpportunities, ServiceError } from "@/lib/services/crm-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ stuck: [] })

  try {
    const stuck = await listStuckOpportunities({ orgId })
    return NextResponse.json({ stuck })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pipeline stuck-deals list error:", error)
    return NextResponse.json({ error: "Failed to fetch stuck deals" }, { status: 500 })
  }
}
