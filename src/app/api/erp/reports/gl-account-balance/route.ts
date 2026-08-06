// FI-GL-002 "G/L Account Balance Display" (SAP FS10N equivalent). Thin
// route over erp-financial-report-service.ts's glAccountBalanceDisplay --
// see that function's own header comment for the design rationale.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { glAccountBalanceDisplay, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const sp = request.nextUrl.searchParams
    const accountIds = sp.get("accountIds")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
    if (!accountIds.length) return NextResponse.json({ error: "accountIds is required (comma-separated)" }, { status: 400 })
    const now = new Date()
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const fromDate = sp.get("fromDate") || defaultFrom
    const toDate = sp.get("toDate") || now.toISOString().slice(0, 10)
    const companyId = sp.get("companyId") || undefined
    const consolidate = sp.get("consolidate") === "true"
    const report = await glAccountBalanceDisplay({ orgId }, accountIds, fromDate, toDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GL account balance display error:", error)
    return NextResponse.json({ error: "Failed to generate GL account balance display" }, { status: 500 })
  }
}
