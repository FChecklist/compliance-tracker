// Priority 15 (PROJEXA Sales & CRM): thin alias over erp-selling-service.ts's
// listQuotations/createQuotation -- a genuine service-layer gap closed by
// this wave (erp_quotations/erp_quotation_items existed in schema.ts since
// Wave 60 with zero service-layer consumer). Sits between an opportunity/
// lead and a sales order in the pipeline. Search/filter/pagination and
// revision/approval-lifecycle fields (version, revisionOf, status) are part
// of the base shape from day one -- this route has no legacy flat-array
// caller to preserve compatibility with.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePermission } from "@/lib/services/permission-service"
import { listQuotations, createQuotation, ServiceError, type QuotationItemInput } from "@/lib/services/erp-selling-service"

function toQuotationShape(q: Awaited<ReturnType<typeof listQuotations>>["items"][number]) {
  return {
    id: q.id,
    quotationNumber: q.quotationNumber,
    customerId: q.customerId,
    customerName: q.customer?.customerName ?? null,
    leadId: q.leadId,
    projectId: q.projectId,
    quotationDate: q.quotationDate,
    validTill: q.validTill,
    status: q.status,
    version: q.version,
    revisionOf: q.revisionOf,
    companyId: q.companyId,
    currencyId: q.currencyId,
    exchangeRate: q.exchangeRate,
    grandTotal: q.grandTotal,
    items: q.items?.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, rate: i.rate, amount: i.amount })) ?? [],
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ quotations: [], total: 0, page: 1, pageSize: 25 })

  const params = request.nextUrl.searchParams
  try {
    const result = await listQuotations({ orgId: ctx.orgId }, {
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
      customerId: params.get("customerId") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      companyId: params.get("companyId") ?? undefined,
      page: params.get("page") ? Number(params.get("page")) : undefined,
      pageSize: params.get("pageSize") ? Number(params.get("pageSize")) : undefined,
    })
    return NextResponse.json({ quotations: result.items.map(toQuotationShape), total: result.total, page: result.page, pageSize: result.pageSize })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotations list error:", error)
    return NextResponse.json({ error: "Failed to fetch quotations" }, { status: 500 })
  }
}

// VERIDIAN Review Framework remediation: routed through the shared
// permission-service.ts utility (ERP_ACTION_ROLES["erp.quotations.create"]
// = "member") -- no behavior change from the previous inline
// requireRoleOrScope(ctx, "member", "write") call, just a single source of
// truth for this module's policy shared with [id]/route.ts,
// [id]/convert/route.ts and [id]/revisions/route.ts.
export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requirePermission(ctx, "erp.quotations.create")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    const items: QuotationItemInput[] = (body.items ?? []).map((i: QuotationItemInput) => ({
      itemId: i.itemId, description: i.description, quantity: i.quantity, rate: i.rate,
    }))
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const quotation = await createQuotation(actorCtx, {
      customerId: body.customerId, leadId: body.leadId, projectId: body.projectId, companyId: body.companyId,
      quotationDate: body.quotationDate, validTill: body.validTill,
      currencyId: body.currencyId, exchangeRate: body.exchangeRate, items,
    })
    return NextResponse.json(quotation, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotation create error:", error)
    return NextResponse.json({ error: "Failed to create quotation" }, { status: 500 })
  }
}
