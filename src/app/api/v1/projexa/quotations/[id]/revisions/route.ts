// Priority 15 (Sales & CRM depth wave): quotation revisioning, thin alias
// over erp-selling-service.ts's createQuotationRevision. Creates a NEW
// quotation row (its own quotationNumber) linked via version/revisionOf --
// see that function's own comment for why an in-place edit was rejected.
//
// VERIDIAN Review Framework remediation: routed through the shared
// permission-service.ts utility (ERP_ACTION_ROLES["erp.quotations.revise"]
// = "member") -- no behavior change.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireActingPerson } from "@/lib/supabase/auth-guard"
import { requirePermission } from "@/lib/services/permission-service"
import { createQuotationRevision, ServiceError, type QuotationItemInput } from "@/lib/services/erp-selling-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requirePermission(ctx, "erp.quotations.revise")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  // PROJEXA-E2E-001 actor-misattribution sweep: see requireActingPerson's own
  // header in auth-guard.ts -- the new revision's createdById feeds
  // updateQuotationStatus()'s 'approved'-transition isSelfApproval() check,
  // so a misattributed creator id here defeats that gate for the revision.
  // U-20b: no acting-user signal is now a 400, never the key's own id.
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const itemsOverride: QuotationItemInput[] | undefined = Array.isArray(body.items)
      ? body.items.map((i: QuotationItemInput) => ({ itemId: i.itemId, description: i.description, quantity: i.quantity, rate: i.rate }))
      : undefined
    const actorCtx = { orgId: ctx.orgId, userId: acting.person.id, ...acting.actor }
    const revision = await createQuotationRevision(actorCtx, id, itemsOverride)
    return NextResponse.json(revision, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotation revision error:", error)
    return NextResponse.json({ error: "Failed to create quotation revision" }, { status: 500 })
  }
}
