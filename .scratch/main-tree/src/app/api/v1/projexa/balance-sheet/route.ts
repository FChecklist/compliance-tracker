// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-financial-report-service.ts's balanceSheet -- asset/liability/equity
// accounts as of a date, pure aggregation, no new business logic.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { balanceSheet, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const sp = request.nextUrl.searchParams
    const asOfDate = sp.get("asOfDate") || new Date().toISOString().slice(0, 10)
    const companyId = sp.get("companyId") || undefined
    const consolidate = sp.get("consolidate") === "true"
    const report = await balanceSheet({ orgId: ctx.orgId }, asOfDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa balance-sheet error:", error)
    return NextResponse.json({ error: "Failed to generate balance sheet" }, { status: 500 })
  }
}
