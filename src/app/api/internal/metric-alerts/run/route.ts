import { NextRequest, NextResponse } from "next/server"
import { evaluateAllMetricAlertRules } from "@/lib/services/metric-alert-service"
import { checkTicketSlaBreaches } from "@/lib/services/ticket-service"
import { checkTaskOverdue } from "@/lib/services/task-service"
import { reprioritizeTasks } from "@/lib/services/task-reprioritization-service"
import { checkCostCeilingBreaches } from "@/lib/cost-guard"

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
 *
 * GAP-CONTINUOUS-REPRIORITIZATION (Tree 1 D22.B2.S1) adds reprioritizeTasks()
 * as a fourth consumer of this same run -- deliberately reusing this
 * existing scheduled job instead of standing up new background-job
 * infrastructure, exactly as checkTaskOverdue did before it. Distinct from
 * checkTaskOverdue: that function only notifies (read-only); reprioritizeTasks
 * is the real WRITE to tasks.priority. See task-reprioritization-service.ts's
 * own header for the honest scope of what this does and does not cover.
 *
 * AI Cost Governance & FinOps gap-closure (2026-07-18) adds
 * checkCostCeilingBreaches() as a fifth consumer -- same reuse-this-cron
 * reasoning, notify-only like checkTicketSlaBreaches/checkTaskOverdue. See
 * cost-guard.ts for what it checks and why it re-notifies daily rather than
 * tracking dedup state.
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
    const [metricAlerts, ticketSla, taskOverdue, taskReprioritization, costCeiling] = await Promise.all([
      evaluateAllMetricAlertRules(),
      checkTicketSlaBreaches(),
      checkTaskOverdue(),
      reprioritizeTasks(),
      checkCostCeilingBreaches(),
    ])
    return NextResponse.json({ ranAt: new Date().toISOString(), metricAlerts, ticketSla, taskOverdue, taskReprioritization, costCeiling })
  } catch (error) {
    console.error("Metric alert evaluation run failed:", error)
    return NextResponse.json({ error: "Metric alert evaluation run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
