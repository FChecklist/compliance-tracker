import { NextRequest, NextResponse } from "next/server"
import { generateRecurringEngagements } from "@/lib/services/firm-engagement-service"

/**
 * Cron-triggered entry point for THE FIRM's recurring engagement
 * automation -- scans every org with the_firm enabled and, for each
 * engagement whose nextOccurrenceDate has arrived, clones the next
 * period's engagement. Same shared-secret pattern as
 * /api/internal/the-firm/deadline-digest/run and
 * /api/internal/metric-alerts/run -- there is no user session for a
 * scheduled job.
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
    const result = await generateRecurringEngagements()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("THE FIRM recurring engagement run failed:", error)
    return NextResponse.json({ error: "THE FIRM recurring engagement run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
