import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLeadsPaged, createLead, ServiceError } from "@/lib/services/crm-service"

// Wave 3 (2026-07-21): listLeadsPaged already existed (Priority 15) with
// real search/filter/pagination -- this route only ever called the older
// unpaged listLeads, a real "software already built, never wired" gap at
// 100-employee/500-project scale. Same query-param shape as
// /api/crm/accounts (the paginated precedent in this same module).
//
// VERIDIAN Review Framework gap-closure (2026-08-07), "Search, Filter &
// Bulk Operations": ownerId/source/companyId filters added alongside the
// existing search/status -- listLeadsPaged() already accepted them
// (Priority 17), this route just wasn't passing them through yet.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 25 })

  const { searchParams } = new URL(request.url)

  try {
    const result = await listLeadsPaged(
      { orgId },
      {
        search: searchParams.get("search") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        ownerId: searchParams.get("ownerId") ?? undefined,
        source: searchParams.get("source") ?? undefined,
        companyId: searchParams.get("companyId") ?? undefined,
        page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
        pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM leads list error:", error)
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const lead = await createLead({ orgId, userId: dbUser.id, role: dbUser.role }, body)
    return NextResponse.json(lead, { status: 201 })
  } catch (error) {
    // VERIDIAN Review Framework gap-closure, "Error Handling & Data
    // Validation Messaging": ServiceError.fields carries Zod's per-field
    // messages when validation failed -- additive alongside `error`.
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, fields: error.fields }, { status: error.status })
    console.error("CRM lead create error:", error)
    return NextResponse.json({ error: "Failed to create lead" }, { status: 500 })
  }
}
