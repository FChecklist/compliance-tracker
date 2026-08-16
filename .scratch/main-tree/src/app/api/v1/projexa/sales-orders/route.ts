// Priority 15 (PROJEXA Sales & CRM): thin alias over erp-selling-service.ts's
// listSalesOrders/createSalesOrder -- another genuine service-layer gap
// closed by this wave (erp_sales_orders/erp_sales_order_items existed in
// schema.ts since Wave 60 with zero consumer). Closes the pipeline: lead ->
// opportunity (crm-service.ts) -> quotation -> sales order, all real,
// end-to-end. Search/filter/pagination/projectId linkage are part of the
// base shape from day one -- no legacy flat-array caller to preserve.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePermission } from "@/lib/services/permission-service"
import { listSalesOrders, createSalesOrder, ServiceError, type SalesOrderItemInput } from "@/lib/services/erp-selling-service"

function toSalesOrderShape(so: Awaited<ReturnType<typeof listSalesOrders>>["items"][number]) {
  return {
    id: so.id,
    soNumber: so.soNumber,
    customerId: so.customerId,
    customerName: so.customer?.customerName ?? null,
    opportunityId: so.opportunityId,
    quotationId: so.quotationId,
    projectId: so.projectId,
    companyId: so.companyId,
    orderDate: so.orderDate,
    deliveryDate: so.deliveryDate,
    status: so.status,
    currencyId: so.currencyId,
    exchangeRate: so.exchangeRate,
    grandTotal: so.grandTotal,
    items: so.items?.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, rate: i.rate, amount: i.amount, deliveredQuantity: i.deliveredQuantity })) ?? [],
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ salesOrders: [], total: 0, page: 1, pageSize: 25 })

  const params = request.nextUrl.searchParams
  try {
    const result = await listSalesOrders({ orgId: ctx.orgId }, {
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
      customerId: params.get("customerId") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      companyId: params.get("companyId") ?? undefined,
      page: params.get("page") ? Number(params.get("page")) : undefined,
      pageSize: params.get("pageSize") ? Number(params.get("pageSize")) : undefined,
    })
    return NextResponse.json({ salesOrders: result.items.map(toSalesOrderShape), total: result.total, page: result.page, pageSize: result.pageSize })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-orders list error:", error)
    return NextResponse.json({ error: "Failed to fetch sales orders" }, { status: 500 })
  }
}

// VERIDIAN Review Framework remediation: routed through the shared
// permission-service.ts utility (ERP_ACTION_ROLES["erp.sales_orders.create"]
// = "member") -- no behavior change from the previous inline
// requireRoleOrScope(ctx, "member", "write") call, just a single source of
// truth for this module's policy shared with [id]/route.ts and
// bulk-status/route.ts.
export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requirePermission(ctx, "erp.sales_orders.create")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    const items: SalesOrderItemInput[] = (body.items ?? []).map((i: SalesOrderItemInput) => ({
      itemId: i.itemId, description: i.description, quantity: i.quantity, rate: i.rate,
    }))
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const salesOrder = await createSalesOrder(actorCtx, {
      customerId: body.customerId, opportunityId: body.opportunityId, quotationId: body.quotationId, projectId: body.projectId, companyId: body.companyId,
      orderDate: body.orderDate, deliveryDate: body.deliveryDate,
      currencyId: body.currencyId, exchangeRate: body.exchangeRate, items,
    })
    return NextResponse.json(salesOrder, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-order create error:", error)
    return NextResponse.json({ error: "Failed to create sales order" }, { status: 500 })
  }
}
