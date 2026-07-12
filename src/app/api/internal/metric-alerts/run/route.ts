import { NextRequest, NextResponse } from "next/server"
import { evaluateAllMetricAlertRules } from "@/lib/services/metric-alert-service"
import { checkTicketSlaBreaches } from "@/lib/services/ticket-service"
import { checkTaskOverdue } from "@/lib/services/task-service"

/**
 * Cron-triggered entry point for Wave 38's metric alert rules
 * (PLATFORM_STRATEGY.md §22), also evaluating Wave 39's ticket SLA
 * deadlines (§21) -- one scheduled-evaluation mechanism serving multiple
 * consumers rather than a second cron job. subagent/audit-lifecycle
 * (tree4-unified/50-completion-plan Priority 2 item 3, D22/U-D22.B1.S1)
 * adds task-domain overdue detection (checkTaskOverdue) as a third
 * consumer of this same run, extending "Missed-timelines" follow-up
 * coverage from compliance items + tickets to tasks. Same shared-secret
 * pattern as /api/internal/loops/run and /api/internal/instruction-audit/run
 * -- there is no user session for a scheduled job.
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
    const [metricAlerts, ticketSla, taskOverdue] = await Promise.all([
      evaluateAllMetricAlertRules(),
      checkTicketSlaBreaches(),
      checkTaskOverdue(),
    ])
    return NextResponse.json({ ranAt: new Date().toISOString(), metricAlerts, ticketSla, taskOverdue })
  } catch (error) {
    console.error("Metric alert evaluation run failed:", error)
    return NextResponse.json({ error: "Metric alert evaluation run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
