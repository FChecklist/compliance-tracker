// FI-AP-002 "Vendor Balances". Thin route over erp-invoicing-service.ts's
// vendorBalances -- see that function's own header comment for the design
// rationale.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { vendorBalances, ServiceError } from "@/lib/services/erp-invoicing-service"
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  try {
    const report = await vendorBalances({ orgId })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Vendor balances error:", error)
    return NextResponse.json({ error: "Failed to generate vendor balances report" }, { status: 500 })
  }
}
