// Priority 15 (Sales & CRM depth wave): bulk owner reassignment, thin alias
// over crm-service.ts's bulkReassignLeads. A firm at this scale needs to
// redistribute a rep's queue across many leads at once (e.g. on leave), not
// one PATCH per lead.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { bulkReassignLeads, ServiceError } from "@/lib/services/crm-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!Array.isArray(body.leadIds) || !body.leadIds.length) return NextResponse.json({ error: "leadIds (non-empty array) is required" }, { status: 400 })
    const updated = await bulkReassignLeads({ orgId: ctx.orgId, userId: actorId }, body.leadIds, body.ownerId ?? null)
    return NextResponse.json({ updated: updated.map((l) => ({ id: l.id, ownerId: l.ownerId })) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leads bulk-reassign error:", error)
    return NextResponse.json({ error: "Failed to bulk-reassign leads" }, { status: 500 })
  }
}
