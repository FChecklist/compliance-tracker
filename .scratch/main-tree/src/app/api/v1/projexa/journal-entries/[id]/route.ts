// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-accounting-service.ts's getJournalEntry -- the line-item detail view
// for a single General Ledger entry (journal-entries/route.ts's list is
// header-only).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getJournalEntry, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const entry = await getJournalEntry({ orgId: ctx.orgId }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa journal-entry detail error:", error)
    return NextResponse.json({ error: "Failed to fetch journal entry" }, { status: 500 })
  }
}
