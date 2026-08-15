// FI-AP-008 (SAP-equivalent gap analysis, "Subcontractor Payment Application
// Status", BUILD_NEW/HIGH): thin route over erp-payment-entries-service.ts's
// subcontractorPaymentApplicationStatus -- a worklist of every subcontractor
// pay-type payment entry (a real payment application, already-existing
// draft -> submitted -> approved/rejected workflow, see that function's own
// header for the full discovery notes) plus every subcontractor purchase
// invoice with an outstanding balance and no payment entry started yet.
// Each row carries its real current status, submission date (when known --
// null for entries still in draft), amount, and daysInCurrentStatus, the
// real aging signal for a stuck application. No dedicated UI page yet --
// API-only, same honest "no dashboard surface" caveat this wave's sibling
// reports (FI-AR-004/FI-AP-005/FI-AP-007) already disclose.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { subcontractorPaymentApplicationStatus, ServiceError } from "@/lib/services/erp-payment-entries-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const supplierId = request.nextUrl.searchParams.get("supplierId") ?? undefined
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined

    const worklist = await subcontractorPaymentApplicationStatus({ orgId: ctx.orgId }, { supplierId, asOfDate })
    return NextResponse.json(worklist)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa subcontractor-payment-application-status error:", error)
    return NextResponse.json({ error: "Failed to generate subcontractor payment application status" }, { status: 500 })
  }
}
