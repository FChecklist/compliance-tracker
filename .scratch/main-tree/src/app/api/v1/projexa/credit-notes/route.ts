// Priority 15 (PROJEXA Invoicing module, Wave 1): thin ALIASING route over
// erp-credit-note-service.ts's Sales Credit Notes -- extends the invoicing
// surface Priority 13's sales-invoices/route.ts started. Purchase-side
// credit notes (vendor refunds/adjustments) are NOT aliased here -- this
// wave's invoicing scope is the revenue side, matching sales-invoices'
// own scope; deferred to a follow-up alongside a fuller AP surface.
// createSalesCreditNote's ctx type was extended this same wave to accept a
// Bearer-key (apiKey) actor -- see that function's own comment in
// erp-credit-note-service.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSalesCreditNotes, createSalesCreditNote, ServiceError } from "@/lib/services/erp-credit-note-service"

function toCreditNoteShape(n: Awaited<ReturnType<typeof listSalesCreditNotes>>[number]) {
  return {
    id: n.id, creditNoteNumber: n.creditNoteNumber, customerId: n.customerId, salesInvoiceId: n.salesInvoiceId,
    postingDate: n.postingDate, reason: n.reason, status: n.status, totalAmount: n.totalAmount,
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ creditNotes: [] })

  try {
    const notes = await listSalesCreditNotes({ orgId: ctx.orgId })
    return NextResponse.json({ creditNotes: notes.map(toCreditNoteShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa credit-notes list error:", error)
    return NextResponse.json({ error: "Failed to fetch credit notes" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const note = await createSalesCreditNote(actorCtx, {
      customerId: body.customerId, salesInvoiceId: body.salesInvoiceId, postingDate: body.postingDate,
      reason: body.reason, items: body.items ?? [],
    })
    return NextResponse.json(toCreditNoteShape(note), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa credit-note create error:", error)
    return NextResponse.json({ error: "Failed to create credit note" }, { status: 500 })
  }
}
