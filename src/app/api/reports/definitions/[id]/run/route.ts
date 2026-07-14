import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { executeReportDefinition, ServiceError } from "@/lib/services/report-engine-service"

type RouteContext = { params: Promise<{ id: string }> }

// POST { params?: Record<string, unknown> } -- runs the definition through
// the generic engine dispatcher (report-engine-service.ts's
// executeReportDefinition). This is the one real execution endpoint every
// report_definitions row runs through, regardless of executionType.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const result = await executeReportDefinition({ orgId, userId: dbUser?.id }, id, body.params ?? {})
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report definition execute error:", error)
    return NextResponse.json({ error: "Failed to run report definition" }, { status: 500 })
  }
}
