// Search, Filter & Bulk Operations gap-closure (bulk half): thin route over
// crm-accounts-service.ts#bulkReassignAccounts, same shape as
// v1/projexa/leads/bulk-reassign/route.ts's precedent for leads.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { bulkReassignAccounts, ServiceError } from "@/lib/services/crm-accounts-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    if (!Array.isArray(body.accountIds) || !body.accountIds.length) {
      return NextResponse.json({ error: "accountIds (non-empty array) is required" }, { status: 400 })
    }
    const updated = await bulkReassignAccounts({ orgId, userId: dbUser.id, dbUser }, body.accountIds, body.ownerId ?? null)
    return NextResponse.json({ updated: updated.map((a) => ({ id: a.id, ownerId: a.ownerId })) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM accounts bulk-reassign error:", error)
    return NextResponse.json({ error: "Failed to bulk-reassign accounts" }, { status: 500 })
  }
}
