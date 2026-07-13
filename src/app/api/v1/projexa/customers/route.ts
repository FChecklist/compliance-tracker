// Priority 13 (ERP discovery lookups): thin alias over
// erp-selling-service.ts's listCustomers/createCustomer -- the customer-side
// twin of vendors/route.ts's supplier alias. Creating a sales invoice via
// /api/v1/projexa/sales-invoices needs a real customerId; without this,
// PROJEXA would have the exact same "guess an opaque ID" problem that
// fiscal-years/cost-centers solve for budgets.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listCustomers, createCustomer, ServiceError, type CustomerInput } from "@/lib/services/erp-selling-service"

function toCustomerShape(c: Awaited<ReturnType<typeof listCustomers>>[number]) {
  return { id: c.id, customerName: c.customerName, gstin: c.gstin, pan: c.panNumber, defaultPaymentTermsDays: c.defaultPaymentTermsDays, creditLimit: c.creditLimit, isActive: c.isActive }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ customers: [] })

  try {
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
