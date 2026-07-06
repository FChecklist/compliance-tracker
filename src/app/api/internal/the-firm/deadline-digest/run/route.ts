import { NextRequest, NextResponse } from "next/server"
import { runFirmDeadlineDigest } from "@/lib/services/firm-practice-dashboard-service"

/**
 * Cron-triggered entry point for Wave 108's THE FIRM AI OS deadline digest
 * -- scans every org with the_firm enabled and computes upcoming
 * compliance/tax-case/engagement-deliverable deadlines within 14 days.
 * Same shared-secret pattern as /api/internal/metric-alerts/run and
 * /api/internal/fm-ppm/generate-occurrences/run -- there is no user
 * session for a scheduled job.
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
    const result = await runFirmDeadlineDigest()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("THE FIRM deadline digest run failed:", error)
    return NextResponse.json({ error: "THE FIRM deadline digest run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
