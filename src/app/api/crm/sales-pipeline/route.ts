import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getSalesPipelineOverview, ServiceError } from "@/lib/services/crm-service"

// In-app KPI wiring gap (generalized CRM gap analysis):
// getSalesPipelineOverview() already existed (Priority 15) and was already
// exposed externally at /api/v1/projexa/sales-pipeline (requireAuthOrApiKey,
// meant for outside/PROJEXA callers), but nothing inside this app's own
// session-authenticated surface ever called it -- the CRM overview page
// (src/app/(app)/crm/page.tsx) only ever fetched flat module counts. This is
// the thin, session-only sibling route: same service call, same
// requireAuth()/ServiceError-mapping convention as every other route in
// src/app/api/crm/** (e.g. leads/route.ts), not a reuse of the external
// v1/projexa route (that one is for outside callers and uses
// requireAuthOrApiKey -- a different, wider trust boundary than an in-app
// page fetch should rely on).
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const overview = await getSalesPipelineOverview({ orgId })
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM sales-pipeline overview error:", error)
    return NextResponse.json({ error: "Failed to fetch sales pipeline overview" }, { status: 500 })
  }
}
