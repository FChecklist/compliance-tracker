// FI-AP-001 "Vendor Line Item Display" (SAP FBL1N equivalent). Thin route
// over erp-accounting-service.ts's listVendorLineItems -- see that
// function's own header comment for the design rationale.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listVendorLineItems, ServiceError } from "@/lib/services/erp-accounting-service"
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  try {
    const sp = request.nextUrl.searchParams
    const partyIds = sp.get("partyIds")?.split(",").map((s) => s.trim()).filter(Boolean)
    const fromDate = sp.get("fromDate") || undefined
    const toDate = sp.get("toDate") || undefined
    const page = sp.get("page") ? Number(sp.get("page")) : undefined
    const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined
    const report = await listVendorLineItems({ orgId }, { partyIds, fromDate, toDate, page, limit })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Vendor line items error:", error)
    return NextResponse.json({ error: "Failed to generate vendor line item report" }, { status: 500 })
  }
}
