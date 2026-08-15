import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listContactsPaged, ServiceError } from "@/lib/services/crm-accounts-service"

// Wave 3 (2026-07-21): first-ever org-wide contacts list -- previously
// contacts could only be listed per-account (listContactsForAccount).
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 25 })

  try {
    const { searchParams } = new URL(request.url)
    const result = await listContactsPaged(
      { orgId },
      {
        search: searchParams.get("search") ?? undefined,
        accountId: searchParams.get("accountId") ?? undefined,
        page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
        pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM contacts list error:", error)
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 })
  }
}
