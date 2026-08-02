// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// submitPurchaseOrder -- moves a draft PO to 'submitted' so goods receipts
// can be recorded against it.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitPurchaseOrder, ServiceError } from "@/lib/services/erp-buying-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const po = await submitPurchaseOrder(actorCtx, id)
    return NextResponse.json(po)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement purchase-order submit error:", error)
    return NextResponse.json({ error: "Failed to submit purchase order" }, { status: 500 })
  }
}
