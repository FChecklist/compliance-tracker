// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-financial-report-service.ts's trialBalance -- pure aggregation over
// the existing chart of accounts + journal entry lines, no new business
// logic. Mirrors the session-only /api/erp/reports/trial-balance route's
// own query-param shape (asOfDate/companyId/consolidate) exactly.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { trialBalance, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const sp = request.nextUrl.searchParams
    const asOfDate = sp.get("asOfDate") || new Date().toISOString().slice(0, 10)
    const companyId = sp.get("companyId") || undefined
    const consolidate = sp.get("consolidate") === "true"
    const report = await trialBalance({ orgId: ctx.orgId }, asOfDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa trial-balance error:", error)
    return NextResponse.json({ error: "Failed to generate trial balance" }, { status: 500 })
  }
}
