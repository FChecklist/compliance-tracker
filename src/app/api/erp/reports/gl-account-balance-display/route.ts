// FI-GL-002 (SAP FS10N equivalent, "G/L Account Balances Display",
// EXTEND_EXISTING, sap_mapping.sqlite/sap_reports, engine_track=calculation):
// thin route over erp-financial-report-service.ts's glAccountBalanceDisplay
// -- same shape/auth convention as the sibling /api/erp/reports/trial-balance
// route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { glAccountBalanceDisplay, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const accountIds = request.nextUrl.searchParams.getAll("accountId")
    if (!accountIds.length) return NextResponse.json({ error: "At least one accountId query param is required" }, { status: 400 })
    const now = new Date()
    const fromDate = request.nextUrl.searchParams.get("fromDate") || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const toDate = request.nextUrl.searchParams.get("toDate") || now.toISOString().slice(0, 10)
    const companyId = request.nextUrl.searchParams.get("companyId") || undefined
    const consolidate = request.nextUrl.searchParams.get("consolidate") === "true"
    const report = await glAccountBalanceDisplay({ orgId }, accountIds, fromDate, toDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GL account balance display error:", error)
    return NextResponse.json({ error: "Failed to generate G/L account balance display" }, { status: 500 })
  }
}
