// Priority 15 (Sales & CRM depth wave): bulk owner reassignment, thin alias
// over crm-service.ts's bulkReassignOpportunities. Same rationale as the
// sibling leads/bulk-reassign/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { bulkReassignOpportunities, ServiceError } from "@/lib/services/crm-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!Array.isArray(body.opportunityIds) || !body.opportunityIds.length) return NextResponse.json({ error: "opportunityIds (non-empty array) is required" }, { status: 400 })
    const updated = await bulkReassignOpportunities({ orgId: ctx.orgId, userId: actorId }, body.opportunityIds, body.ownerId ?? null)
    return NextResponse.json({ updated: updated.map((o) => ({ id: o.id, ownerId: o.ownerId })) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa opportunities bulk-reassign error:", error)
    return NextResponse.json({ error: "Failed to bulk-reassign opportunities" }, { status: 500 })
  }
}
