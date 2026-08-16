import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { cancelPaymentEntry, ServiceError } from "@/lib/services/erp-payment-entries-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const entry = await cancelPaymentEntry({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payment entry cancel error:", error)
    return NextResponse.json({ error: "Failed to cancel payment entry" }, { status: 500 })
  }
}
