// FI-AP-007 (Subcontractor Retention Summary, sap_mapping.sqlite gap
// analysis, BUILD_NEW/HIGH): thin ALIASING route over erp-invoicing-
// service.ts's subcontractorRetentionSummary -- per-subcontractor summary
// of retention withheld to date, released, and still held. Reshapes
// supplierId/supplierName into vendorId/vendorName per this namespace's
// existing vendor terminology convention (see /api/v1/projexa/vendors/
// route.ts's own header -- the underlying erp_suppliers table is shared with
// non-construction products and is not renamed, only this response shape is).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { subcontractorRetentionSummary, ServiceError } from "@/lib/services/erp-invoicing-service"

function toVendorShape(entry: Awaited<ReturnType<typeof subcontractorRetentionSummary>>["subcontractors"][number]) {
  return {
    vendorId: entry.supplierId,
    vendorName: entry.supplierName,
    totalRetentionAmount: entry.totalRetentionAmount,
    totalRetentionReleased: entry.totalRetentionReleased,
    totalRetentionHeld: entry.totalRetentionHeld,
    bills: entry.bills.map((bill) => ({
      invoiceId: bill.invoiceId,
      invoiceNumber: bill.invoiceNumber,
      postingDate: bill.postingDate,
      grandTotal: bill.grandTotal,
      status: bill.status,
      retentionPercent: bill.retentionPercent,
      retentionAmount: bill.retentionAmount,
      retentionReleased: bill.retentionReleased,
      retentionHeld: bill.retentionHeld,
    })),
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const vendorId = request.nextUrl.searchParams.get("vendorId") ?? undefined

    const summary = await subcontractorRetentionSummary({ orgId: ctx.orgId }, { supplierId: vendorId })
    return NextResponse.json({
      vendorCount: summary.subcontractorCount,
      billCount: summary.billCount,
      totalRetentionWithheld: summary.totalRetentionWithheld,
      totalRetentionReleased: summary.totalRetentionReleased,
      totalRetentionHeld: summary.totalRetentionHeld,
      vendors: summary.subcontractors.map(toVendorShape),
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa subcontractor-retention-summary error:", error)
    return NextResponse.json({ error: "Failed to generate subcontractor retention summary" }, { status: 500 })
  }
}
