import { NextRequest, NextResponse } from "next/server"
import { evaluateAllMetricAlertRules } from "@/lib/services/metric-alert-service"

/**
 * Cron-triggered entry point for Wave 38's metric alert rules
 * (PLATFORM_STRATEGY.md §22). Same shared-secret pattern as
 * /api/internal/loops/run and /api/internal/instruction-audit/run -- there
 * is no user session for a scheduled job.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await evaluateAllMetricAlertRules()
    return NextResponse.json({ ranAt: new Date().toISOString(), result })
  } catch (error) {
    console.error("Metric alert evaluation run failed:", error)
    return NextResponse.json({ error: "Metric alert evaluation run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
