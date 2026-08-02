// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-financial-report-service.ts's profitAndLoss -- income/expense accounts
// over a date range, pure aggregation, no new business logic.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { profitAndLoss, ServiceError } from "@/lib/services/erp-financial-report-service"

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
    const companyId = sp.get("companyId") || undefined
    const consolidate = sp.get("consolidate") === "true"
    const report = await profitAndLoss({ orgId: ctx.orgId }, fromDate, toDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa profit-and-loss error:", error)
    return NextResponse.json({ error: "Failed to generate profit and loss statement" }, { status: 500 })
  }
}
