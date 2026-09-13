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
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, readActingUserId, readActingUserEmail } from "@/lib/supabase/auth-guard"
import { updateLineItemBudget, updateLineItemMoneyFields, ServiceError } from "@/lib/services/construction-boq-service"
// R85 Addendum 3 v4 Phase 6 (gates 6-01/6-03a/6-03c): the response below
// echoes the same dual-view fields GET /api/v1/construction/boq/[id]
// redacts -- a write response is exactly as reachable a surface as a read
// one (6-03c: "a project-side field present in JSON but hidden by CSS IS A
// LEAK"), so it goes through the identical gate rather than assuming a
// PATCH response is somehow exempt.
import { applyCostVisibility } from "@/lib/services/cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json()
    let updated = await updateLineItemBudget({ orgId: ctx.orgId }, id, {
      budgetPercentage: body.budgetPercentage,
      vendorId: body.vendorId,
      vendorAmount: body.vendorAmount,
      materialAmount: body.materialAmount,
      manpowerAmount: body.manpowerAmount,
      category: body.category,
    })

    // R85 Addendum 3 v4, Phase 2 (gates 2-01/2-02/2-04): the grid's own four
    // dual-view columns. Optional and independent of the budget-overlay
    // fields above -- a caller that sends only budgetPercentage (every
    // existing caller, before this change) is unaffected, and the grid can
    // send just these four with no budget fields present.
    const hasMoneyFieldEdit =
      body.qtyProject !== undefined || body.rateProject !== undefined ||
      body.qtyContract !== undefined || body.rateContract !== undefined
    if (hasMoneyFieldEdit) {
      updated = await updateLineItemMoneyFields({ orgId: ctx.orgId }, id, {
        qtyProject: body.qtyProject,
        rateProject: body.rateProject,
        qtyContract: body.qtyContract,
        rateContract: body.rateContract,
      })
    }

    let role: UserRole | null = (ctx.dbUser?.role as UserRole | undefined) ?? null
    if (!ctx.dbUser && ctx.apiKey) {
      const acting = await resolveActingUser(ctx, readActingUserEmail(request), readActingUserId(request))
      role = (acting.user?.role as UserRole | undefined) ?? null
    }
    const responseBody = await applyCostVisibility({ orgId: ctx.orgId }, role, updated)
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ line-item update error:", error)
    return NextResponse.json({ error: "Failed to update line item" }, { status: 500 })
  }
}
