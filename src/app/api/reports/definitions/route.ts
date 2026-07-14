import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listReportDefinitions, createReportDefinition, ServiceError } from "@/lib/services/report-engine-service"

// GET ?category=<cat>&classification=<cls> -- every definition visible to
// this org (its own + every platform-wide one), per the Reports & Analysis
// Engine (Priority 11).
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ definitions: [] })

  const category = request.nextUrl.searchParams.get("category") ?? undefined
  const classification = request.nextUrl.searchParams.get("classification") ?? undefined

  try {
    const definitions = await listReportDefinitions({ orgId }, { category, classification })
    return NextResponse.json({ definitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report definitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch report definitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createReportDefinition({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report definition create error:", error)
    return NextResponse.json({ error: "Failed to create report definition" }, { status: 500 })
  }
}
