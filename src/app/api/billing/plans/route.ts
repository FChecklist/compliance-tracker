import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listBillingPlans } from "@/lib/services/platform-billing-service"

// Any authenticated user can see the priced plan list (same posture as the
// public pricing page it backs) -- no admin gate needed for a read of
// non-sensitive plan pricing.
export async function GET() {
  const { user, response } = await requireAuth()
  if (!user) return response!

  try {
    const plans = await listBillingPlans()
    return NextResponse.json({ plans })
  } catch (error) {
    console.error("Billing plans list error:", error)
    return NextResponse.json({ error: "Failed to load billing plans" }, { status: 500 })
  }
}
