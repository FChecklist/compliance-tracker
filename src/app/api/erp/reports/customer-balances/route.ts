// FI-AR-002 "Customer Balances". Thin route over erp-invoicing-service.ts's
// customerBalances -- see that function's own header comment for the
// design rationale.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { customerBalances, ServiceError } from "@/lib/services/erp-invoicing-service"
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  try {
    const report = await customerBalances({ orgId })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Customer balances error:", error)
    return NextResponse.json({ error: "Failed to generate customer balances report" }, { status: 500 })
  }
}
