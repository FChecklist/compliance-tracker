import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { bulkReassignOpportunities, ServiceError } from "@/lib/services/crm-service"

// VERIDIAN Review Framework gap-closure: Sales Pipeline (2026-08-07),
// "Search, Filter & Bulk Operations" finding. bulkReassignOpportunities()
// (crm-service.ts, Priority 15) already existed but only had a consumer
// under /api/v1/projexa/opportunities/bulk-reassign (the external API) --
// this is the first native in-app route, wired to the new Pipeline tab's
// multi-select toolbar.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const opportunities = await bulkReassignOpportunities({ orgId, userId: dbUser.id }, body.opportunityIds, body.ownerId ?? null)
    return NextResponse.json({ opportunities })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM opportunities bulk-reassign error:", error)
    return NextResponse.json({ error: "Failed to reassign opportunities" }, { status: 500 })
  }
}
