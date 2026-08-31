// FI-AP-003 "Vendor Items -- Aging Report". Thin route over
// erp-invoicing-service.ts's apAgingReport -- see that function's own
// header comment for the design rationale (the AP mirror of
// arAgingReport, which currently has no dedicated /api/erp/reports route
// of its own, only the PROJEXA-specific /api/v1/projexa/ar-aging).
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { apAgingReport, ServiceError } from "@/lib/services/erp-invoicing-service"
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") || undefined
    const report = await apAgingReport({ orgId }, asOfDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("AP aging report error:", error)
    return NextResponse.json({ error: "Failed to generate AP aging report" }, { status: 500 })
  }
}
