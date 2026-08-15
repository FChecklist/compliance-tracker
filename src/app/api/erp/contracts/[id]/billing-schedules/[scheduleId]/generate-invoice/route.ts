// SD-002 (Billing Due List) action endpoint: the real "generate the
// invoice" link the report-engine-service.ts#computeBillingDueList
// worklist points callers at (each row carries the Contract ID/Schedule ID
// this route needs). Same auth/error shape as the sibling
// billing-schedules/route.ts POST above.
import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { generateInvoiceFromBillingSchedule, ServiceError } from "@/lib/services/erp-contract-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string; scheduleId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id, scheduleId } = await params
    const result = await generateInvoiceFromBillingSchedule({ orgId, userId: dbUser.id, dbUser }, id, scheduleId)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Billing schedule generate-invoice error:", error)
    return NextResponse.json({ error: "Failed to generate invoice from billing schedule" }, { status: 500 })
  }
}
