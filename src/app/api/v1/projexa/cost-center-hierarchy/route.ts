// CO-003 (SAP-equivalent, "Cost Center Hierarchy Report", EXTEND_EXISTING,
// sap_mapping.sqlite/sap_reports, engine_track=calculation): thin route over
// erp-accounting-service.ts's costCenterHierarchyReport -- see that
// function's own header comment for the real design (overhead spend
// rolled up through the real parent_cost_center_id tree). No dedicated UI
// page yet -- API-only, same honest "no dashboard surface" caveat this
// wave's sibling reports already disclose.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { costCenterHierarchyReport, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const now = new Date()
    const fromDate = request.nextUrl.searchParams.get("fromDate") || new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
    const toDate = request.nextUrl.searchParams.get("toDate") || now.toISOString().slice(0, 10)
    const report = await costCenterHierarchyReport({ orgId: ctx.orgId }, fromDate, toDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa cost-center-hierarchy error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
