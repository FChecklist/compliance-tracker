import { NextRequest, NextResponse } from "next/server"
import { generateAiPerformanceReport } from "@/lib/services/ai-performance-report-service"

/**
 * Cron-triggered entry point for tree4-unified U-D19.B1.S1's daily AI
 * performance report -- see ai-performance-report-service.ts's own header
 * for exactly what's real vs. honestly disclosed as uncovered. Same
 * shared-secret pattern as every other /api/internal/*\/run route (no user
 * session for a scheduled job).
 *
 * No persistence layer yet -- like /api/internal/metric-alerts/run, this
 * computes and returns the report; there is no dashboard/inbox surface to
 * read it from later (same class of honestly-disclosed scope limit as this
 * session's other backend-first Priority-2 work). If the Owner wants a
 * historical record, that's a small additive migration (a report-snapshots
 * table) layered on top of this function, not a rewrite of it.
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
    const report = await generateAiPerformanceReport(1)
    return NextResponse.json({ ranAt: new Date().toISOString(), report })
  } catch (error) {
    console.error("AI performance report run failed:", error)
    return NextResponse.json({ error: "AI performance report run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
