import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { runCustomChart, ServiceError } from "@/lib/services/custom-chart-service"

type RouteContext = { params: Promise<{ id: string }> }

// POST -- runs a saved custom chart definition live through report-engine-
// service.ts's runAggregationFromConfig(), the same dispatcher a
// deterministic_aggregation report_definitions row runs through.
export async function POST(_request: Request, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await runCustomChart({ orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Custom chart run error:", error)
    return NextResponse.json({ error: "Failed to run custom chart" }, { status: 500 })
  }
}
