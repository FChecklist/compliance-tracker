import { NextRequest, NextResponse } from "next/server"
import { generateRoutingAccuracyReport } from "@/lib/services/routing-accuracy-report-service"

/**
 * Cron-triggered entry point for the weekly AI Orchestra routing-accuracy
 * report (VERIDIAN Review Framework remediation, "No measured
 * routing-accuracy metric exists at all") -- see
 * routing-accuracy-report-service.ts's own header for exactly what this
 * measures and how. Same shared-secret pattern as every other
 * /api/internal/*\/run route (no user session for a scheduled job).
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
    const report = await generateRoutingAccuracyReport(7)
    if (report.recommendPredictiveModelSelectionReview) {
      console.warn(
        `[routing-accuracy-report] negative-signal rate crossed the review threshold this week ` +
        `(${report.escalatedCount + report.gatedCount + report.missedEscalationCount}/${report.totalRoutingDecisions}) -- ` +
        `see ai-os/MASTER-TRACKER.yaml's predictive-model-selection decision for what this means.`
      )
    }
    return NextResponse.json({ ranAt: new Date().toISOString(), report })
  } catch (error) {
    console.error("Routing accuracy report run failed:", error)
    return NextResponse.json({ error: "Routing accuracy report run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
