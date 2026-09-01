// Real-screen conversion (2026-08-30): PROJEXA-reachable alias of
// erp-invoicing-service.ts's submitSalesInvoice -- see that function's own
// comment for why this route did NOT already exist (VERIDIAN's own
// /api/erp/sales-invoices/[id]/submit requires a real session dbUser and is
// unreachable from PROJEXA's Bearer-key caller). Posts the real GL entry
// (debit receivable, credit the chosen revenue account) and moves the
// invoice from draft -> submitted, the same transition
// erp/invoicing/page.tsx's own "Post" button drives internally.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitSalesInvoice, ServiceError } from "@/lib/services/erp-invoicing-service"

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
    const invoice = await submitSalesInvoice(actorCtx, id, { revenueAccountId: body.revenueAccountId })
    return NextResponse.json(invoice)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-invoice submit error:", error)
    return NextResponse.json({ error: "Failed to submit sales invoice" }, { status: 500 })
  }
}
