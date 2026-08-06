// FI-GL-007 (SAP-equivalent, "Subledger-to-GL Reconciliation", BUILD_NEW,
// sap_mapping.sqlite/sap_reports, engine_track=calculation): thin route
// over erp-financial-report-service.ts's subledgerToGlReconciliation --
// same shape/auth convention as the sibling /api/erp/reports/trial-balance
// route. See that function's own header comment for the full design and
// honest scope (AR/AP only -- fixed assets are FI-AA-006's own report,
// stock is not included because stock movements do not yet post to the GL
// in this codebase).
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { subledgerToGlReconciliation, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") || new Date().toISOString().slice(0, 10)
    const companyId = request.nextUrl.searchParams.get("companyId") || undefined
    const consolidate = request.nextUrl.searchParams.get("consolidate") === "true"
    const report = await subledgerToGlReconciliation({ orgId }, asOfDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Subledger-to-GL reconciliation error:", error)
    return NextResponse.json({ error: "Failed to generate subledger-to-GL reconciliation report" }, { status: 500 })
  }
}
