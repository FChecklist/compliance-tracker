// Real-screen conversion (2026-08-30): single-customer GET/PATCH for the
// Customer Object Page's Edit/Deactivate actions -- getCustomer() didn't
// exist before (list/create/update did; the aggregated 360 overview at
// ../[id]/overview/route.ts did too, but that's a different, heavier read).
// Same toCustomerShape mapping as ../route.ts's own GET (duplicated locally,
// matching this codebase's sales-orders/[id] precedent).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getCustomer, updateCustomer, ServiceError } from "@/lib/services/erp-selling-service"

function toCustomerShape(c: Awaited<ReturnType<typeof getCustomer>>) {
  return { id: c.id, customerName: c.customerName, gstin: c.gstin, pan: c.panNumber, defaultPaymentTermsDays: c.defaultPaymentTermsDays, creditLimit: c.creditLimit, isActive: c.isActive }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const customer = await getCustomer({ orgId: ctx.orgId }, id)
    return NextResponse.json(toCustomerShape(customer))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa customer get error:", error)
    return NextResponse.json({ error: "Failed to fetch customer" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const patch = {
      ...(body.customerName !== undefined ? { customerName: body.customerName } : {}),
      ...(body.gstin !== undefined ? { gstin: body.gstin } : {}),
      ...(body.pan !== undefined ? { panNumber: body.pan } : {}),
      ...(body.defaultPaymentTermsDays !== undefined ? { defaultPaymentTermsDays: body.defaultPaymentTermsDays } : {}),
      ...(body.creditLimit !== undefined ? { creditLimit: body.creditLimit } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    }
    const customer = await updateCustomer({ orgId: ctx.orgId }, id, patch)
    return NextResponse.json(toCustomerShape(customer))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa customer update error:", error)
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 })
  }
}
