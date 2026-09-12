import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getBoq, ServiceError } from "@/lib/services/construction-boq-service"
// R85 Addendum 3 v4 Phase 6 (gates 6-01/6-03a): THE ONE GATE, see
// cost-visibility-service.ts's own header. This internal route was found
// missing this call entirely while wiring Phase 2's dual-view figures in
// (getBoq() already returned raw qtyProject/rateProject columns before that,
// so this gap pre-dates Phase 2 -- Phase 6's own PR only touched the v1
// routes). client_viewer is a PROJEXA-only role (never reachable through
// this internal, compliance-tracker-only route), so the real-world exposure
// was to internal staff only, not a customer -- still closed here rather
// than left as a known gap, per "no route may invent its own visibility
// check" / every route that serves BOQ line items applies the same gate.
import { applyCostVisibility } from "@/lib/services/cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const boq = await getBoq({ orgId }, id)
    const role = (dbUser?.role as UserRole | undefined) ?? null
    const responseBody = await applyCostVisibility({ orgId }, role, boq)
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction BOQ get error:", error)
    return NextResponse.json({ error: "Failed to fetch BOQ" }, { status: 500 })
  }
}
