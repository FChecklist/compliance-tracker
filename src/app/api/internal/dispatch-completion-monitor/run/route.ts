import { NextRequest, NextResponse } from "next/server"
import { db, organisations, users, monitorExecutionLog } from "@/lib/db"
import { and, asc, eq } from "drizzle-orm"
import { runDispatchCompletionSweep, DISPATCH_COMPLETION_MONITOR_NAME } from "@/lib/monitors/dispatch-completion-monitor"

/**
 * Cron-triggered entry point for PR #257's dispatch-completion monitor --
 * closes gap #1 that PR's own header named ("pull-based only, no cron
 * wiring"). Gap #2 ("no persisted digest") is closed by the insert into
 * monitor_execution_log at the end of runSweepAcrossAllOrgs() below (table
 * defined in src/lib/db/schema.ts, migration drizzle/0175). Cross-referenced
 * both ways with ai-os/sentinel/SENTINEL.yaml's new related_monitors entry
 * -- SENTINEL's own point-in-time PR/commit checks are a different surface
 * from this ongoing dispatch-completion-drift monitor; see that file.
 *
 * Same shared-secret pattern as every other /api/internal/*\/run route
 * (isAuthorized() below, verbatim from loops/run's route.ts) -- there is no
 * user session for a scheduled job.
 *
 * Why this route can't just call runDispatchCompletionSweep() once, unlike
 * loops/run's runActiveLoops() or metric-alerts/run's evaluateAllMetric
 * AlertRules(): those crons' underlying work is either genuinely platform-
 * wide (no org concept at all) or reads/writes via the raw `db` client with
 * no per-row attribution required (metric-alert-service.ts's own comment:
 * "a scheduled job has no single request-scoped org"). This monitor is
 * different -- runDispatchCompletionSweep(orgId, dbUser, ...) is
 * org-and-actor-scoped by design: it calls claimEscalation() (single-owner
 * lock per org) and logActivity() (audit trail attribution) inside its own
 * withTenantContext(). A cron has no session-derived dbUser, so this route
 * iterates every organisation (data-separation-audit.ts's own
 * db.query.organisations.findMany() pattern -- see that file for the
 * precedent) and, for each, attributes the sweep to that org's longest-
 * tenured active veridian_admin user -- the same class of actor a human
 * veridian_admin hitting the existing pull-based route
 * (/api/ai/team/monitor/dispatch-completion) already is. An org with no
 * active veridian_admin user is skipped -- never fabricates an actor --
 * and counted separately so that's visible in the response, not silently
 * dropped.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000 // matches the pull-based route's DEFAULT_STALE_THRESHOLD_MS and drizzle/0174's max_execution_time_ms -- the same "stuck" definition everywhere this monitor runs.

// Cron runs once daily (see vercel.json) -- was every 6 hours until
// 2026-07-14, which exceeded the Vercel Hobby plan's once-per-day cron
// limit and was silently failing every deploy. Since STALE_AFTER_MS above
// is itself a 24-hour threshold, a daily sweep still catches every stale
// dispatch the same day it crosses that threshold -- 6-hourly checks were
// never buying earlier detection in practice, only extra invocations.

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

async function runSweepAcrossAllOrgs(request: NextRequest) {
  const orgs = await db.query.organisations.findMany({ columns: { id: true } })

  let checked = 0
  let ok = 0
  let escalated = 0
  let invalidReports = 0
  let orgsSwept = 0
  const orgsSkippedNoAdmin: string[] = []

  for (const org of orgs) {
    const admin = await db.query.users.findFirst({
      where: and(eq(users.orgId, org.id), eq(users.role, "veridian_admin"), eq(users.isActive, true)),
      orderBy: asc(users.createdAt),
    })
    if (!admin) {
      orgsSkippedNoAdmin.push(org.id)
      continue
    }

    try {
      const sweep = await runDispatchCompletionSweep(org.id, admin, STALE_AFTER_MS, request)
      checked += sweep.checked
      ok += sweep.ok
      escalated += sweep.escalated
      invalidReports += sweep.invalidReports
      orgsSwept++
    } catch (err) {
      // One org's sweep failing must not abort the rest -- same
      // fail-isolated-per-unit posture as metric-alert-service.ts's own
      // per-rule try/catch inside evaluateAllMetricAlertRules().
      console.error(`Dispatch-completion sweep failed for org ${org.id}:`, err)
    }
  }

  const summaryText =
    `${checked} checked, ${ok} ok, ${escalated} escalated, ${invalidReports} invalid reports across ${orgsSwept} org(s)` +
    (orgsSkippedNoAdmin.length ? ` (${orgsSkippedNoAdmin.length} org(s) skipped: no active veridian_admin user).` : ".")

  await db.insert(monitorExecutionLog).values({
    monitorName: DISPATCH_COMPLETION_MONITOR_NAME,
    checked,
    ok,
    escalated,
    invalidReports,
    summaryText,
  })

  return {
    orgsSwept,
    orgsSkippedNoAdmin: orgsSkippedNoAdmin.length,
    checked,
    ok,
    escalated,
    invalidReports,
    summaryText,
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await runSweepAcrossAllOrgs(request)
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("Dispatch-completion monitor cron run failed:", error)
    return NextResponse.json({ error: "Dispatch-completion monitor cron run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
