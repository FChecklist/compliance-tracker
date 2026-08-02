import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listOpportunitiesPaged, createOpportunity, ServiceError } from "@/lib/services/crm-service"

// Wave 3 (2026-07-21): listOpportunitiesPaged already existed (Priority 15)
// with real search/filter/pagination -- this route only ever called the
// older unpaged listOpportunities, same class of gap as leads/route.ts.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 25 })

  try {
    const { searchParams } = new URL(request.url)
    const result = await listOpportunitiesPaged(
      { orgId },
      {
        search: searchParams.get("search") ?? undefined,
        stage: searchParams.get("stage") ?? undefined,
        ownerId: searchParams.get("ownerId") ?? undefined,
        erpCustomerId: searchParams.get("erpCustomerId") ?? undefined,
        page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
        pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
      }
    )
    return NextResponse.json(result)
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
