import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { previewCurrentPeriodInvoice } from "@/lib/services/platform-billing-service"

// Live, unpersisted current-period preview -- the "what would my next
// invoice look like right now" dashboard widget. Any authenticated org
// member can see their own org's usage (same posture as org-limits' GET).
export async function GET() {
  const { user, orgId, response } = await requireAuth()
  if (!user) return response!
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const preview = await previewCurrentPeriodInvoice(orgId)
    if (!preview) return NextResponse.json({ error: "No billing plan resolved for this organisation" }, { status: 404 })
    return NextResponse.json(preview)
  } catch (error) {
    console.error("Current billing usage error:", error)
    return NextResponse.json({ error: "Failed to load current billing usage" }, { status: 500 })
  }
}
