import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateInvoiceForPeriod, generatePreviousMonthInvoice } from "@/lib/services/platform-billing-service"

// Admin/manager-gated, same role check as PATCH /api/settings/org-limits --
// generating an invoice is an org-limits-adjacent administrative action, not
// something every member should trigger. Idempotent per (org, period): a
// re-POST for an already-generated period recomputes in place rather than
// duplicating (see platform-billing-service.ts's generateInvoiceForPeriod).
export async function POST(request: NextRequest) {
  const { dbUser, orgId, response } = await requireAuth()
  if (response) return response
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can generate a billing invoice" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const result =
      body.periodStart && body.periodEnd
        ? await generateInvoiceForPeriod(orgId, new Date(body.periodStart), new Date(body.periodEnd))
        : await generatePreviousMonthInvoice(orgId)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Billing invoice generation error:", error)
    const message = error instanceof Error ? error.message : "Failed to generate billing invoice"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
