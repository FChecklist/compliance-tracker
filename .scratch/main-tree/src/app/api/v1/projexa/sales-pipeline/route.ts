// Priority 15 (Sales & CRM depth wave): the pipeline/funnel dashboard's
// cross-cutting rollup -- thin alias over crm-service.ts's
// getSalesPipelineOverview (leads/opportunities side of the funnel).
// Quotation/sales-order totals are a separate, smaller rollup -- see
// quotations/route.ts and sales-orders/route.ts's own `total`/status-group
// fields, composed client-side rather than merged server-side here, since
// they come from a different enablement gate (requireErpEnabled vs
// requireSalesEnabled) and a different service file.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getSalesPipelineOverview, ServiceError } from "@/lib/services/crm-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const overview = await getSalesPipelineOverview({ orgId: ctx.orgId })
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-pipeline overview error:", error)
    return NextResponse.json({ error: "Failed to fetch sales pipeline overview" }, { status: 500 })
  }
}
