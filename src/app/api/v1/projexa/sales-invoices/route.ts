// Priority 13 (ERP discovery lookups): thin alias over
// erp-invoicing-service.ts's listSalesInvoices/createSalesInvoice.
// PROJEXA_GAP_ANALYSIS.md's Dashboard Revenue card only ever *read*
// erp_sales_invoices.grandTotal -- there was no PROJEXA-reachable way to
// create or link one, so a real "revenue" number could never actually
// exist for a construction project. This closes that: a construction PM
// can create an invoice against an ERP customer directly from PROJEXA.
// erp_sales_invoices has no projectId column of its own (see schema.ts) --
// linking an invoice to a specific construction project is done the same
// way every other cross-module link works here, via the generic documents
// table's linkedEntityType/linkedEntityId, or simply by the caller's own
// customerId choice; this route does not invent a new column.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSalesInvoices, createSalesInvoice, ServiceError, type SalesInvoiceItemInput } from "@/lib/services/erp-invoicing-service"

function toInvoiceShape(inv: Awaited<ReturnType<typeof listSalesInvoices>>[number]) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerId: inv.customerId,
    customerName: inv.customer?.customerName ?? null,
    postingDate: inv.postingDate,
    dueDate: inv.dueDate,
    grandTotal: inv.grandTotal,
    outstandingAmount: inv.outstandingAmount,
    status: inv.status,
    items: inv.items?.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, rate: i.rate, amount: i.amount })) ?? [],
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ salesInvoices: [] })

  try {
    const invoices = await listSalesInvoices({ orgId: ctx.orgId })
    return NextResponse.json({ salesInvoices: invoices.map(toInvoiceShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-invoices list error:", error)
    return NextResponse.json({ error: "Failed to fetch sales invoices" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const items: SalesInvoiceItemInput[] = (body.items ?? []).map((i: SalesInvoiceItemInput) => ({
      itemId: i.itemId, description: i.description, quantity: i.quantity, rate: i.rate, taxTemplateId: i.taxTemplateId,
    }))
    // createSalesInvoice now accepts either a real dbUser (session caller)
    // or an apiKey (PROJEXA's callVeridian() Bearer-token path -- always
    // this branch, since it never carries a session cookie) -- see that
    // function's own Priority 13 comment for why this was a real fix, not
    // just a route-level workaround.
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const invoice = await createSalesInvoice(actorCtx, {
      customerId: body.customerId, postingDate: body.postingDate, dueDate: body.dueDate,
      currencyId: body.currencyId, exchangeRate: body.exchangeRate, companyId: body.companyId,
      items,
    })
    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-invoice create error:", error)
    return NextResponse.json({ error: "Failed to create sales invoice" }, { status: 500 })
  }
}
