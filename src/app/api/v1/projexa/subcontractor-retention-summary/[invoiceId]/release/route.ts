// FI-AP-007 (Subcontractor Retention Summary): releases some or all of one
// subcontractor bill's still-held retention. Mirrors dunning-list/
// [invoiceId]/record/route.ts's auth/actor-ctx shape exactly (the closest
// existing "the only mutation on a report-adjacent invoice field" precedent
// in this namespace). Does NOT post a payment/journal entry -- see
// releaseSubcontractorRetention's own header comment in
// erp-invoicing-service.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { releaseSubcontractorRetention, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { invoiceId } = await params
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const updated = await releaseSubcontractorRetention(actorCtx, invoiceId, { amount: Number(body.amount) })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa subcontractor-retention-summary release error:", error)
    return NextResponse.json({ error: "Failed to release retention" }, { status: 500 })
  }
}
