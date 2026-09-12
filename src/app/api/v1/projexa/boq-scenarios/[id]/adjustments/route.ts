// R85 Addendum 3 v4, Phase 10 -- gates 10-02/10-03/10-08/10-13.
//
// POST adds one adjustment: a plain `{ lineItemId, ... }` body calls
// addAdjustment (10-02, one line); a body carrying `selector` instead calls
// addBulkAdjustment (10-03: a selection, a trade/section, or the whole BOQ).
// DELETE (`?lineItemId=`) reverts one line to the base BOQ.
//
// 10-08: neither verb ever touches the live BOQ -- both write ONLY
// boq_scenario's own adjustments column (enforced inside boq-scenario-
// service.ts, proven by that file's own committed falsifiability test).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { addAdjustment, addBulkAdjustment, removeAdjustment, ServiceError, type AddAdjustmentInput, type AddBulkAdjustmentInput } from "@/lib/services/boq-scenario-service"

type PostBody =
  | (AddAdjustmentInput)
  | (AddBulkAdjustmentInput)

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr

  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "No actor identity on this request" }, { status: 400 })

  try {
    const { id } = await params
    const body = (await request.json()) as PostBody

    if ("selector" in body) {
      const updated = await addBulkAdjustment({ orgId: ctx.orgId, userId: actorId }, id, body as AddBulkAdjustmentInput)
      return NextResponse.json(updated)
    }
    const updated = await addAdjustment({ orgId: ctx.orgId, userId: actorId }, id, body as AddAdjustmentInput)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-scenarios add adjustment error:", error)
    return NextResponse.json({ error: "Failed to add adjustment" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr

  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "No actor identity on this request" }, { status: 400 })

  const lineItemId = request.nextUrl.searchParams.get("lineItemId")
  if (!lineItemId) return NextResponse.json({ error: "lineItemId is required" }, { status: 400 })

  try {
    const { id } = await params
    const updated = await removeAdjustment({ orgId: ctx.orgId, userId: actorId }, id, lineItemId)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-scenarios remove adjustment error:", error)
    return NextResponse.json({ error: "Failed to remove adjustment" }, { status: 500 })
  }
}
