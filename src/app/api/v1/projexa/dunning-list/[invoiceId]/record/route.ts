// FI-AR-004 (Dunning List): records that a dunning notice (Friendly
// Reminder / Formal Notice / Final Demand) was sent for one invoice.
// Mirrors sales-invoices/[id]/payments/route.ts's auth/actor-ctx shape
// exactly. Does NOT send an actual letter/email -- see recordDunningAction's
// own header comment in erp-invoicing-service.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { recordDunningAction, ServiceError } from "@/lib/services/erp-invoicing-service"

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
    const updated = await recordDunningAction(actorCtx, invoiceId, Number(body.level))
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa dunning-list record error:", error)
    return NextResponse.json({ error: "Failed to record dunning action" }, { status: 500 })
  }
}
