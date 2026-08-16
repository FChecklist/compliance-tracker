import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { executeReportDefinition, ServiceError } from "@/lib/services/report-engine-service"

type RouteContext = { params: Promise<{ id: string }> }

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16, 2026-07-16). Thin POST alias over the
// SAME executeReportDefinition() dispatcher the session-auth route (src/app/
// api/reports/definitions/[id]/run/route.ts, built by #375) already calls --
// this is the ONE real execution endpoint every report_definitions row runs
// through regardless of executionType, for BOTH compliance-tracker's own
// /reports page and PROJEXA's catalog UI. No second engine here.
// requireAuthOrApiKey because PROJEXA calls server-to-server with a Bearer
// vk_... API key, matching every other /v1/projexa/* route.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
    const result = await executeReportDefinition({ orgId: ctx.orgId, userId: actorId }, id, body.params ?? {})
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa report definition execute error:", error)
    return NextResponse.json({ error: "Failed to run report definition" }, { status: 500 })
  }
}
