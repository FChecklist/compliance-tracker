import { NextRequest, NextResponse } from "next/server"
import { scanForL2Violations, scanForL4PendingEscalations } from "@/lib/audit-cadence-scan"

/**
 * Cron-triggered entry point for area 9's L2 (Continuous Monitoring) audit
 * cadence -- same shared-secret pattern as /api/internal/metric-alerts/run
 * and /api/internal/loops/run, since there is no user session for a
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
    const [l2, l4] = await Promise.all([scanForL2Violations(), scanForL4PendingEscalations()])
    return NextResponse.json({ ranAt: new Date().toISOString(), l2, l4 })
  } catch (error) {
    console.error("Audit cadence scan run failed:", error)
    return NextResponse.json({ error: "Audit cadence scan run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
