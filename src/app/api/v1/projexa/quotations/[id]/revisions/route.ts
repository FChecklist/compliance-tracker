// Priority 15 (Sales & CRM depth wave): quotation revisioning, thin alias
// over erp-selling-service.ts's createQuotationRevision. Creates a NEW
// quotation row (its own quotationNumber) linked via version/revisionOf --
// see that function's own comment for why an in-place edit was rejected.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createQuotationRevision, ServiceError, type QuotationItemInput } from "@/lib/services/erp-selling-service"

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
    const body = await request.json().catch(() => ({}))
    const itemsOverride: QuotationItemInput[] | undefined = Array.isArray(body.items)
      ? body.items.map((i: QuotationItemInput) => ({ itemId: i.itemId, description: i.description, quantity: i.quantity, rate: i.rate }))
      : undefined
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const revision = await createQuotationRevision(actorCtx, id, itemsOverride)
    return NextResponse.json(revision, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotation revision error:", error)
    return NextResponse.json({ error: "Failed to create quotation revision" }, { status: 500 })
  }
}
