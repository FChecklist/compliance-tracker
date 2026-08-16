// Priority 13 (ERP discovery lookups): thin alias over
// erp-selling-service.ts's listCustomers/createCustomer -- the customer-side
// twin of vendors/route.ts's supplier alias. Creating a sales invoice via
// /api/v1/projexa/sales-invoices needs a real customerId; without this,
// PROJEXA would have the exact same "guess an opaque ID" problem that
// fiscal-years/cost-centers solve for budgets.
//
// Priority 15 (Sales & CRM depth wave): adds opt-in search/pagination via
// listCustomersPaged -- only engaged when the caller passes `search`/
// `page`/`pageSize`, so every existing picker/dropdown call site (no query
// params) keeps getting the full flat array, unchanged.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listCustomers, listCustomersPaged, createCustomer, ServiceError, type CustomerInput } from "@/lib/services/erp-selling-service"

function toCustomerShape(c: { id: string; customerName: string; gstin: string | null; panNumber: string | null; defaultPaymentTermsDays: number | null; creditLimit: string | null; isActive: boolean }) {
  return { id: c.id, customerName: c.customerName, gstin: c.gstin, pan: c.panNumber, defaultPaymentTermsDays: c.defaultPaymentTermsDays, creditLimit: c.creditLimit, isActive: c.isActive }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ customers: [] })

  const params = request.nextUrl.searchParams
  const wantsPaging = params.has("search") || params.has("page") || params.has("pageSize")

  try {
    if (wantsPaging) {
      const result = await listCustomersPaged({ orgId: ctx.orgId }, {
        search: params.get("search") ?? undefined,
        page: params.get("page") ? Number(params.get("page")) : undefined,
        pageSize: params.get("pageSize") ? Number(params.get("pageSize")) : undefined,
      })
      return NextResponse.json({ customers: result.items.map(toCustomerShape), total: result.total, page: result.page, pageSize: result.pageSize })
    }
    const customers = await listCustomers({ orgId: ctx.orgId })
    return NextResponse.json({ customers: customers.map(toCustomerShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa customers list error:", error)
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const input: CustomerInput = {
      customerName: body.customerName, gstin: body.gstin, panNumber: body.pan,
      defaultPaymentTermsDays: body.defaultPaymentTermsDays, creditLimit: body.creditLimit,
    }
    const customer = await createCustomer({ orgId: ctx.orgId }, input)
    return NextResponse.json(toCustomerShape(customer), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa customer create error:", error)
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 })
  }
}
