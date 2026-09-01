// Real-screen conversion (2026-08-30): PROJEXA-reachable alias of
// erp-credit-note-service.ts's submitSalesCreditNote -- had zero route on
// either side before this (not even a VERIDIAN-internal one), so every
// credit note created via PROJEXA stayed "draft" forever. Unlike sales
// invoice submission this takes no body -- a credit note carries no revenue
// account choice, it just flips draft -> submitted.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitSalesCreditNote, ServiceError } from "@/lib/services/erp-credit-note-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const note = await submitSalesCreditNote(actorCtx, id)
    return NextResponse.json(note)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa credit-note submit error:", error)
    return NextResponse.json({ error: "Failed to submit credit note" }, { status: 500 })
  }
}
