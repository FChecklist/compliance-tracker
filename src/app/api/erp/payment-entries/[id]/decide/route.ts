// Wave B: the approval decision route. Deliberately has NO webhook
// dispatch and NO payment-gateway call of any kind -- this only ever calls
// decidePaymentEntry, which posts an internal GL journal entry (see that
// function's own header comment). Owner directive: approval/record-keeping
// only, Razorpay stays untouched.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { decidePaymentEntry, ServiceError } from "@/lib/services/erp-payment-entries-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const { decision, comment } = await request.json()
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
    }

    const entry = await decidePaymentEntry({ orgId, userId: dbUser.id, dbUser }, id, decision, comment)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payment entry decision error:", error)
    return NextResponse.json({ error: "Failed to record payment entry decision" }, { status: 500 })
  }
}
