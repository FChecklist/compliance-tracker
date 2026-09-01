// VERIDIAN Review Framework gap-closure, "Search, Filter & Bulk
// Operations": bulkReassignLeads() already existed in crm-service.ts (built
// for the /api/v1/projexa/leads/bulk-reassign alias) but the native
// /api/crm/leads surface had no bulk-select/bulk-reassign UI or endpoint of
// its own.
//
// Security fix (rebase of PR #1014, replacing it after a human AUDIT: FAIL):
// this route originally called bulkReassignLeads() with no role passed at
// all, so the manager-rank gate that bulkReassignLeads() now enforces
// (canReassignOrDeleteLead, matching the single-lead PATCH path in
// [id]/route.ts) was silently never checked -- any authenticated org member
// could bulk-reassign every lead in the org. Now passes dbUser.role, same
// shape as [id]/route.ts's PATCH/DELETE handlers.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { bulkReassignLeads, ServiceError } from "@/lib/services/crm-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    if (!Array.isArray(body.leadIds) || !body.leadIds.length) {
      return NextResponse.json({ error: "leadIds (non-empty array) is required" }, { status: 400 })
    }
    const updated = await bulkReassignLeads({ orgId, userId: dbUser.id, role: dbUser.role }, body.leadIds, body.ownerId ?? null)
    return NextResponse.json({ updated: updated.map((l) => ({ id: l.id, ownerId: l.ownerId })) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM leads bulk-reassign error:", error)
    return NextResponse.json({ error: "Failed to bulk-reassign leads" }, { status: 500 })
  }
}
