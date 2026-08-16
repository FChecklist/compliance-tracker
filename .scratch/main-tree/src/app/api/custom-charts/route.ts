import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCustomCharts, createCustomChart, getTableRegistryMetadata, ServiceError } from "@/lib/services/custom-chart-service"

// Priority 13 (Self-Serve Ad-Hoc BI / Chart-Builder). ?meta=1 returns the
// TABLE_REGISTRY dataset metadata (table keys + whitelisted column keys)
// the chart-builder UI needs to populate its dataset/column pickers --
// string keys only, never the real Drizzle table/column objects.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ charts: [] })

  try {
    if (request.nextUrl.searchParams.get("meta") === "1") {
      return NextResponse.json({ datasets: getTableRegistryMetadata() })
    }
    const charts = await listCustomCharts({ orgId })
    return NextResponse.json({ charts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Custom charts list error:", error)
    return NextResponse.json({ error: "Failed to fetch custom charts" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createCustomChart({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Custom chart create error:", error)
    return NextResponse.json({ error: "Failed to create custom chart" }, { status: 500 })
  }
}
