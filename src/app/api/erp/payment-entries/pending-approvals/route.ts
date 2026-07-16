import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPendingPaymentApprovals, ServiceError } from "@/lib/services/erp-payment-entries-service"

/** "My Approvals" inbox for payment entries -- submitted entries the current user's rank qualifies to decide, excluding their own submissions. */
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ entries: [] })

  try {
    const entries = await listPendingPaymentApprovals({ orgId, userId: dbUser.id, dbUser })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payment entries pending-approvals error:", error)
    return NextResponse.json({ error: "Failed to fetch pending approvals" }, { status: 500 })
  }
}
