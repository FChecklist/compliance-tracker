// FI-GL-008 "G/L Account Group Balances Summary". Thin route over erp-
// financial-report-service.ts's glAccountGroupBalancesSummary -- see that
// function's own header comment for the design rationale.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { glAccountGroupBalancesSummary, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const sp = request.nextUrl.searchParams
    const asOfDate = sp.get("asOfDate") || new Date().toISOString().slice(0, 10)
    const companyId = sp.get("companyId") || undefined
    const consolidate = sp.get("consolidate") === "true"
    const report = await glAccountGroupBalancesSummary({ orgId }, asOfDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GL account group balances summary error:", error)
    return NextResponse.json({ error: "Failed to generate GL account group balances summary" }, { status: 500 })
  }
}
