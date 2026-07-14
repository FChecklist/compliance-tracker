// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-accounting-service.ts's General Ledger (listJournalEntries/
// createJournalEntry). POST creates a DRAFT entry only -- submitting it
// (which posts to the ledger, gated by the accounting-period lock and an
// optional approval workflow) is intentionally left to VERIDIAN's own UI
// for this wave, same as accounts/route.ts's read-only chart of accounts.
// createJournalEntry's ctx type was extended this same wave to accept a
// Bearer-key (apiKey) actor, not just a session dbUser -- see that
// function's own comment in erp-accounting-service.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listJournalEntriesPaged, createJournalEntry, ServiceError, type JournalEntryInput } from "@/lib/services/erp-accounting-service"

function toEntryShape(e: { id: string; entryNumber: number; postingDate: string; referenceType: string | null; referenceId: string | null; userRemark: string | null; status: string; totalDebit: string; totalCredit: string; companyId: string | null }) {
  return {
    id: e.id, entryNumber: e.entryNumber, postingDate: e.postingDate, referenceType: e.referenceType,
    referenceId: e.referenceId, userRemark: e.userRemark, status: e.status,
    totalDebit: e.totalDebit, totalCredit: e.totalCredit, companyId: e.companyId,
  }
}

// 500-project scale: real DB-level pagination (page/limit) plus
// status/date-range/search filters -- see listJournalEntriesPaged's own
// comment in erp-accounting-service.ts.
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ entries: [], total: 0, page: 1, limit: 25, totalPages: 0 })

  try {
    const sp = request.nextUrl.searchParams
    const result = await listJournalEntriesPaged({ orgId: ctx.orgId }, {
      status: sp.get("status") ?? undefined,
      fromDate: sp.get("fromDate") ?? undefined,
      toDate: sp.get("toDate") ?? undefined,
      search: sp.get("search") ?? undefined,
      page: sp.get("page") ? Number(sp.get("page")) : undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    })
    return NextResponse.json({ entries: result.entries.map(toEntryShape), total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa journal-entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch journal entries" }, { status: 500 })
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
    const input: JournalEntryInput = {
      postingDate: body.postingDate, userRemark: body.userRemark, referenceType: body.referenceType,
      referenceId: body.referenceId, companyId: body.companyId, lines: body.lines ?? [],
    }
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const entry = await createJournalEntry(actorCtx, input)
    return NextResponse.json(toEntryShape(entry), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa journal-entry create error:", error)
    return NextResponse.json({ error: "Failed to create journal entry" }, { status: 500 })
  }
}
