import { NextRequest, NextResponse } from "next/server"
import { detectCostAnomalies } from "@/lib/services/cost-anomaly-service"

/**
 * Cron-triggered entry point for the daily Cost Anomaly report
 * (AI Cost Governance & FinOps gap-closure, 2026-07-18) -- see
 * cost-anomaly-service.ts's own header for the ratio-based deviation check
 * this runs. Same shared-secret pattern as every other /api/internal/*\/run
 * route (no user session for a scheduled job) -- mirrors
 * /api/internal/ai-performance-report/run.
 *
 * No persistence layer, same honestly-disclosed scope limit as its
 * siblings: this computes and returns the report, there is no
 * dashboard/inbox surface to read it from later.
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
    const report = await detectCostAnomalies()
    return NextResponse.json({ ranAt: new Date().toISOString(), report })
  } catch (error) {
    console.error("Cost anomaly report run failed:", error)
    return NextResponse.json({ error: "Cost anomaly report run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
