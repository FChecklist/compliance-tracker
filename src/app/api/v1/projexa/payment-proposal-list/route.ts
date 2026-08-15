// FI-AP-005 (SAP F110 "Payment Proposal List" equivalent, sap_mapping.sqlite
// gap analysis, BUILD_NEW/HIGH): thin ALIASING route over erp-invoicing-
// service.ts's paymentProposalList -- vendor bills due/overdue for payment,
// grouped by vendor, the review step before an actual payment run. Reshapes
// supplierId/supplierName into vendorId/vendorName per this namespace's
// existing vendor terminology convention (see /api/v1/projexa/vendors/
// route.ts's own header -- the underlying erp_suppliers table is shared with
// non-construction products and is not renamed, only this response shape is).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { paymentProposalList, ServiceError } from "@/lib/services/erp-invoicing-service"

function toVendorShape(entry: Awaited<ReturnType<typeof paymentProposalList>>["suppliers"][number]) {
  return {
    vendorId: entry.supplierId,
    vendorName: entry.supplierName,
    totalAmount: entry.totalAmount,
    bills: entry.lines.map((line) => ({
      invoiceId: line.invoiceId,
      invoiceNumber: line.invoiceNumber,
      postingDate: line.postingDate,
      dueDate: line.dueDate,
      daysOverdue: line.daysOverdue,
      isOverdue: line.isOverdue,
      outstandingAmount: line.outstandingAmount,
      status: line.status,
      bankAccount: line.bankAccount,
    })),
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const vendorId = request.nextUrl.searchParams.get("vendorId") ?? undefined
    const minAmountParam = request.nextUrl.searchParams.get("minAmount")
    const minAmount = minAmountParam ? Number(minAmountParam) : undefined

    const proposal = await paymentProposalList({ orgId: ctx.orgId }, { asOfDate, supplierId: vendorId, minAmount })
    return NextResponse.json({
      asOfDate: proposal.asOfDate,
      totalProposedAmount: proposal.totalProposedAmount,
      vendorCount: proposal.supplierCount,
      lineCount: proposal.lineCount,
      vendors: proposal.suppliers.map(toVendorShape),
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payment-proposal-list error:", error)
    return NextResponse.json({ error: "Failed to generate payment proposal list" }, { status: 500 })
  }
}
