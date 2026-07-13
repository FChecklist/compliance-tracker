import { NextRequest, NextResponse } from "next/server"
import { runDueReportSchedules } from "@/lib/services/report-schedule-service"

/**
 * Cron-triggered entry point for report_schedules (Owner directive
 * 2026-07-13). Same shared-secret pattern as every other
 * /api/internal/*\/run route (no user session for a scheduled job) --
 * mirrors /api/internal/metric-alerts/run exactly, including its real
 * delivery mechanism (see report-schedule-service.ts's runDueReportSchedules
 * header for why that, not the 3 existing report-cadence crons, is what
 * this reuses).
 *
 * Runs once daily (see vercel.json); isScheduleDue() inside
 * runDueReportSchedules() is what actually filters to weekly/monthly
 * schedules only firing on their configured day -- the cron itself doesn't
 * need per-cadence entries.
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
    const result = await runDueReportSchedules()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("Report schedules run failed:", error)
    return NextResponse.json({ error: "Report schedules run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
