import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLeads, listLeadsPaged, createLead, ServiceError } from "@/lib/services/crm-service"

// VERIDIAN Review Framework gap-closure, "Search, Filter & Bulk
// Operations": listLeadsPaged() already existed in the service layer
// (built for the PROJEXA alias route) but nothing under /api/crm/** called
// it -- GET returned every lead, unfiltered, unpaginated. Backward
// compatible: a request with none of these params still gets the original
// `{ leads: [...] }` flat-array shape (existing callers, e.g. the New
// Opportunity dialog's lead picker, are unaffected). A request with any
// filter/pagination param gets the paginated shape instead.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ leads: [] })

  const url = new URL(request.url)
  const search = url.searchParams.get("search") ?? undefined
  const status = url.searchParams.get("status") ?? undefined
  const ownerId = url.searchParams.get("ownerId") ?? undefined
  const source = url.searchParams.get("source") ?? undefined
  const companyId = url.searchParams.get("companyId") ?? undefined
  const pageParam = url.searchParams.get("page")
  const pageSizeParam = url.searchParams.get("pageSize")
  const hasFilters = !!(search || status || ownerId || source || companyId || pageParam || pageSizeParam)

  try {
    if (!hasFilters) {
      const leads = await listLeads({ orgId })
      return NextResponse.json({ leads })
    }
    const { items, total, page, pageSize } = await listLeadsPaged({ orgId }, {
      search, status, ownerId, source, companyId,
      page: pageParam ? Number(pageParam) : undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
    })
    return NextResponse.json({ leads: items, total, page, pageSize })
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
    const lead = await createLead({ orgId, userId: dbUser.id }, body)
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
