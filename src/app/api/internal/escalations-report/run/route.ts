import { NextRequest, NextResponse } from "next/server"
import { generateEscalationsReport } from "@/lib/services/report-cadence-service"

/**
 * Cron-triggered entry point for the Escalations report (GAP-D19-REPORT-
 * CADENCES, tree4-unified U-D19.B1.S1) -- see report-cadence-service.ts's
 * own header for exactly what's real and how it's sourced. Same shared-
 * secret pattern as every other /api/internal/*\/run route (no user session
 * for a scheduled job) -- mirrors /api/internal/ai-performance-report/run.
 *
 * No persistence layer, same honestly-disclosed scope limit as the daily
 * AI-performance report this mirrors: this computes and returns the report,
 * there is no dashboard/inbox surface to read it from later.
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
    const report = await generateEscalationsReport(1)
    return NextResponse.json({ ranAt: new Date().toISOString(), report })
  } catch (error) {
    console.error("Escalations report run failed:", error)
    return NextResponse.json({ error: "Escalations report run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
