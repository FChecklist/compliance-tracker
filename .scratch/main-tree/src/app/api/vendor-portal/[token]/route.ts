import { NextRequest, NextResponse } from "next/server"
import { getSupplierPortalData, ServiceError } from "@/lib/services/erp-vendor-master-service"

// Public route (no auth) -- resolves a vendor portal token, see
// getSupplierPortalData()'s own comment for why this is a legitimate,
// pre-existing RLS-bypass pattern (identical to /api/guest-chat/[token]).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const data = await getSupplierPortalData(token)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Vendor portal data error:", error)
    return NextResponse.json({ error: "Failed to load vendor portal" }, { status: 500 })
  }
}
