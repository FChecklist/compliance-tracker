// R39/R-C09: PATCH a single BOQ line item's budget overlay (budgetPercentage/
// vendorId/vendorAmount) -- no update path existed for these Point 154
// columns before this (create-only). Matches the sibling v1/construction/boq
// routes' auth pattern (requireAuthOrApiKey).
//
// R67 lane I (WS-I items I-03, I-05): the same PATCH now also carries
// materialAmount/manpowerAmount (C03-16's in-place editors, C03-21/C03-22's
// report columns) and category (R-177). Every field is optional and absent
// still means "leave this one alone", so an existing caller that sends only
// budgetPercentage is completely unaffected.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateLineItemBudget, ServiceError } from "@/lib/services/construction-boq-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json()
    const updated = await updateLineItemBudget({ orgId: ctx.orgId }, id, {
      budgetPercentage: body.budgetPercentage,
      vendorId: body.vendorId,
      vendorAmount: body.vendorAmount,
      materialAmount: body.materialAmount,
      manpowerAmount: body.manpowerAmount,
      category: body.category,
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ line-item budget update error:", error)
    return NextResponse.json({ error: "Failed to update line item budget" }, { status: 500 })
  }
}
