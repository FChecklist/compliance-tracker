// Priority 15 (PROJEXA Sales & CRM): thin alias over crm-service.ts's
// listLeadsPaged/createLead -- the lead stage of the pipeline. crm-service.ts's
// original listLeads/createLead (Wave 41/75/78) are untouched; listLeadsPaged
// is an additive, paginated/filtered variant added this wave specifically
// for this route (native VERIDIAN CRM UI keeps using the flat-array one).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listLeadsPaged, createLead, ServiceError } from "@/lib/services/crm-service"

function toLeadShape(l: { id: string; name: string; contactEmail: string | null; contactPhone: string | null; source: string | null; status: string; ownerId: string | null; convertedClientId: string | null; aiScore: number | null; aiRecommendedAction: string | null; nextActionDate: string | null; nextActionNote: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    id: l.id, name: l.name, contactEmail: l.contactEmail, contactPhone: l.contactPhone,
    source: l.source, status: l.status, ownerId: l.ownerId, convertedClientId: l.convertedClientId,
    aiScore: l.aiScore, aiRecommendedAction: l.aiRecommendedAction,
    nextActionDate: l.nextActionDate, nextActionNote: l.nextActionNote,
    createdAt: l.createdAt, updatedAt: l.updatedAt,
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ leads: [], total: 0, page: 1, pageSize: 25 })

  const params = request.nextUrl.searchParams
  try {
    const result = await listLeadsPaged({ orgId: ctx.orgId }, {
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
      ownerId: params.get("ownerId") ?? undefined,
      source: params.get("source") ?? undefined,
      page: params.get("page") ? Number(params.get("page")) : undefined,
      pageSize: params.get("pageSize") ? Number(params.get("pageSize")) : undefined,
    })
    return NextResponse.json({ leads: result.items.map(toLeadShape), total: result.total, page: result.page, pageSize: result.pageSize })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leads list error:", error)
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 })
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
    const lead = await createLead({ orgId: ctx.orgId, userId: actorId }, {
      name: body.name, contactEmail: body.contactEmail, contactPhone: body.contactPhone,
      source: body.source, ownerId: body.ownerId, nextActionDate: body.nextActionDate, nextActionNote: body.nextActionNote,
    })
    return NextResponse.json(toLeadShape(lead), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa lead create error:", error)
    return NextResponse.json({ error: "Failed to create lead" }, { status: 500 })
  }
}
