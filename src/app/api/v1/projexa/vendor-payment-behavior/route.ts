// FI-AP-006 (Vendor Payment History / Payment Behavior Analysis): thin
// aliasing route over erp-invoicing-service.ts's vendorPaymentBehaviorReport
// -- per-supplier real average days-to-pay, DPO (Days Payable Outstanding),
// and a payment-reliability classification. Mirrors
// subcontractor-retention-summary/route.ts and (once merged) the AR-side
// FI-AR-006 customer-payment-behavior/route.ts's shape exactly. Optional
// query params: periodDays (default 90), asOfDate (default today).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { vendorPaymentBehaviorReport, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const periodDaysParam = request.nextUrl.searchParams.get("periodDays")
    const periodDays = periodDaysParam ? Number(periodDaysParam) : undefined
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const report = await vendorPaymentBehaviorReport({ orgId: ctx.orgId }, { periodDays, asOfDate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor-payment-behavior error:", error)
    return NextResponse.json({ error: "Failed to generate vendor payment behavior report" }, { status: 500 })
  }
}
