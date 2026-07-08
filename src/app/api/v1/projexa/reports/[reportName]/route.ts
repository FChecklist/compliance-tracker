import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { REPORT_REGISTRY, ServiceError, type ReportName } from "@/lib/services/construction-reports-service"

function isValidReportName(value: string): value is ReportName {
  return value in REPORT_REGISTRY
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { reportName } = await params
  if (!isValidReportName(reportName)) {
    return NextResponse.json({ error: `Unknown report. Valid reports: ${Object.keys(REPORT_REGISTRY).join(", ")}` }, { status: 400 })
  }

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    let result
    if (reportName === "weekly-project") {
      const weekStart = request.nextUrl.searchParams.get("weekStart")
      if (!weekStart) return NextResponse.json({ error: "weekStart query param is required for the weekly-project report" }, { status: 400 })
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId, weekStart)
    } else {
      result = await REPORT_REGISTRY[reportName]({ orgId: ctx.orgId }, projectId)
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error(`v1 projexa report "${reportName}" error:`, error)
    return NextResponse.json({ error: `Failed to generate ${reportName} report` }, { status: 500 })
  }
}
