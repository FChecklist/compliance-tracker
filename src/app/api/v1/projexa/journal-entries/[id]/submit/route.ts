// Real-screen conversion (2026-08-30): the General Ledger's real Object Page
// needs a real Submit action. submitJournalEntry() has always existed
// (erp-accounting-service.ts) but was never exposed on the v1/projexa
// surface, and it requires a real ErpContext (dbUser, not an API key) --
// same identity-bridge gap already documented on change-orders/[id]/route.ts
// (submitChangeOrderForApproval) and elsewhere. Following that exact
// established convention rather than inventing a new one: refuse with an
// honest message when there's no real session, instead of silently no-op'ing
// or faking an actor.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitJournalEntry, ServiceError } from "@/lib/services/erp-accounting-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  // submitJournalEntry needs a real actor to attribute the submission to --
  // an API key alone (no dbUser) can't submit one.
  if (!ctx.dbUser) return NextResponse.json({ error: "Submitting a journal entry requires a real user session, not just an API key" }, { status: 400 })

  const roleCheck = requireRoleOrScope(ctx, "senior_professional")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const entry = await submitJournalEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa journal-entry submit error:", error)
    return NextResponse.json({ error: "Failed to submit journal entry" }, { status: 500 })
  }
}
