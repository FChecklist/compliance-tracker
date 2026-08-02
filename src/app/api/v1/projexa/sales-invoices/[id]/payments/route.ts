// Priority 15 (PROJEXA Invoicing module, full lifecycle): thin ALIASING
// route over erp-invoicing-service.ts's recordSalesInvoicePayment -- posts
// a real GL receipt (debit bank/cash, credit receivable) and reduces this
// invoice's own outstandingAmount, flipping status to partially_paid/paid.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { recordSalesInvoicePayment, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const updated = await recordSalesInvoicePayment(actorCtx, id, {
      amount: body.amount, bankOrCashAccountId: body.bankOrCashAccountId, postingDate: body.postingDate, referenceNo: body.referenceNo,
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-invoice payment error:", error)
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 })
  }
}
