// VERIDIAN Review Framework gap-closure, "Search, Filter & Bulk
// Operations": bulkReassignLeads() already existed in crm-service.ts (built
// for the /api/v1/projexa/leads/bulk-reassign alias) but the native
// /api/crm/leads surface had no bulk-select/bulk-reassign UI or endpoint of
// its own. Thin wrapper, same auth posture as every other /api/crm/leads/**
// route (requireAuth(), no extra role/scope gate -- this surface has never
// required one).
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
    const updated = await bulkReassignLeads({ orgId, userId: dbUser.id }, body.leadIds, body.ownerId ?? null)
    return NextResponse.json({ updated: updated.map((l) => ({ id: l.id, ownerId: l.ownerId })) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM leads bulk-reassign error:", error)
    return NextResponse.json({ error: "Failed to bulk-reassign leads" }, { status: 500 })
  }
}
