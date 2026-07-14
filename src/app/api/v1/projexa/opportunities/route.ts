// Priority 15 (PROJEXA Sales & CRM): thin alias over crm-service.ts's
// listOpportunitiesPaged/createOpportunity -- the opportunity stage of the
// pipeline, sitting between a lead and a quotation/sales order.
// listOpportunitiesPaged is an additive paginated/filtered variant (native
// VERIDIAN CRM UI keeps using the original flat-array listOpportunities).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listOpportunitiesPaged, createOpportunity, ServiceError } from "@/lib/services/crm-service"

function toOpportunityShape(o: {
  id: string; name: string; leadId: string | null; clientId: string | null; erpCustomerId: string | null; stage: string;
  estimatedValue: string | null; expectedCloseDate: string | null; ownerId: string | null; aiWinProbability: number | null;
  nextActionDate: string | null; nextActionNote: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: o.id, name: o.name, leadId: o.leadId, clientId: o.clientId, erpCustomerId: o.erpCustomerId, stage: o.stage,
    estimatedValue: o.estimatedValue, expectedCloseDate: o.expectedCloseDate, ownerId: o.ownerId,
    aiWinProbability: o.aiWinProbability, nextActionDate: o.nextActionDate, nextActionNote: o.nextActionNote,
    createdAt: o.createdAt, updatedAt: o.updatedAt,
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ opportunities: [], total: 0, page: 1, pageSize: 25 })

  const params = request.nextUrl.searchParams
  try {
    const result = await listOpportunitiesPaged({ orgId: ctx.orgId }, {
      search: params.get("search") ?? undefined,
      stage: params.get("stage") ?? undefined,
      ownerId: params.get("ownerId") ?? undefined,
      erpCustomerId: params.get("erpCustomerId") ?? undefined,
      page: params.get("page") ? Number(params.get("page")) : undefined,
      pageSize: params.get("pageSize") ? Number(params.get("pageSize")) : undefined,
    })
    return NextResponse.json({ opportunities: result.items.map(toOpportunityShape), total: result.total, page: result.page, pageSize: result.pageSize })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa opportunities list error:", error)
    return NextResponse.json({ error: "Failed to fetch opportunities" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    const opportunity = await createOpportunity({ orgId: ctx.orgId, userId: actorId }, {
      name: body.name, leadId: body.leadId, clientId: body.clientId, erpCustomerId: body.erpCustomerId, stage: body.stage,
      estimatedValue: body.estimatedValue, expectedCloseDate: body.expectedCloseDate, ownerId: body.ownerId,
      nextActionDate: body.nextActionDate, nextActionNote: body.nextActionNote,
    })
    return NextResponse.json(toOpportunityShape(opportunity), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa opportunity create error:", error)
    return NextResponse.json({ error: "Failed to create opportunity" }, { status: 500 })
  }
}
