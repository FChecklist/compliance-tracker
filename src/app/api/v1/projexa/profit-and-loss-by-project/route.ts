// Priority 15 (PROJEXA Accounting module, 500-project scale): thin ALIASING
// route over erp-financial-report-service.ts's profitAndLossByCostCenter --
// per-project revenue/expense/net-profit rollup, since a construction firm
// running ~500 projects needs P&L broken out by project, not just
// company-wide (company-wide P&L is already covered by /profit-and-loss).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { profitAndLossByCostCenter, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const sp = request.nextUrl.searchParams
    const now = new Date()
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const fromDate = sp.get("fromDate") || defaultFrom
    const toDate = sp.get("toDate") || now.toISOString().slice(0, 10)
    const report = await profitAndLossByCostCenter({ orgId: ctx.orgId }, fromDate, toDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa profit-and-loss-by-project error:", error)
    return NextResponse.json({ error: "Failed to generate per-project P&L" }, { status: 500 })
  }
}
