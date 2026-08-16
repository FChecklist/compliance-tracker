import { NextRequest, NextResponse } from "next/server"
import { getActiveAuctionsForSupplierPortal, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

// Public route (no auth) -- resolves the supplier's existing vendor-portal
// token (Wave 80), same RLS-bypass rationale as the rest of that portal.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const auctions = await getActiveAuctionsForSupplierPortal(token)
    return NextResponse.json({ auctions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Vendor portal auctions error:", error)
    return NextResponse.json({ error: "Failed to load auctions" }, { status: 500 })
  }
}
