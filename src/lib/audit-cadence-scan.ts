// tree4-unified area 9 "Auditing": closes the cron-wiring half of the
// L2-L7 gap audit-cadence.ts's own header names as a separate follow-up
// ("Scheduling L2/L3/L5/L6/L7 as real cron loops against activity_log...
// not attempted in this pass"). Scoped honestly: only L2 (Continuous
// Monitoring, "detect failures... every 3 hours") gets a real scan here --
// it is the one level with an unambiguous, already-buildable action
// (find failures, flag for re-audit, using flagForReAudit() already built
// for U-D15.B3.S1). L3/L5/L6/L7's own actions ("identify trends", "deep
// operational analysis", "architecture/KPI review") have no crisp
// deterministic implementation without fabricating logic this codebase's
// own discipline elsewhere refuses to invent -- they remain served by the
// pre-existing 11 daily cron loops + CI mandatory-audit gate, a real if
// different continuous-audit mechanism, not silently dropped.
import { db, activityLog } from "@/lib/db"
import { and, eq, gte, isNull, sql } from "drizzle-orm"
import { flagForReAudit } from "./activity-log-service"

const L2_SCAN_WINDOW_HOURS = 3
const L2_REASON = "L2 Continuous Monitoring: automated failure detection (audit-cadence-scan.ts)"

export type L2ScanResult = {
  scannedWindowHours: number
  candidatesFound: number
  flagged: number
  alreadyFlagged: number
}

/**
 * Cross-org by necessity (a cron job, not a request scoped to one tenant) --
 * uses the raw db client for the read, same posture as every other
 * platform-level /api/internal/*\/run scan in this codebase. Each flag
 * write still goes through flagForReAudit(), which is itself org-scoped and
 * fails closed on not_found/not_terminal, so this scan can never flag a row
 * flagForReAudit() itself would refuse.
 */
export async function scanForL2Violations(): Promise<L2ScanResult> {
  const cutoff = new Date(Date.now() - L2_SCAN_WINDOW_HOURS * 60 * 60 * 1000)

  const candidates = await db
    .select({ id: activityLog.id, orgId: activityLog.orgId })
    .from(activityLog)
    .where(and(
      eq(activityLog.lifecycleStage, "failed"),
      isNull(activityLog.reAuditRequestedAt),
      gte(activityLog.createdAt, cutoff),
    ))

  let flagged = 0
  let alreadyFlagged = 0
  for (const row of candidates) {
    const result = await flagForReAudit({
      orgId: row.orgId,
      activityLogId: row.id,
      reason: L2_REASON,
      requestedBy: "system:audit-cadence-scan",
    })
    if (result.flagged) flagged++
    else alreadyFlagged++
  }

  return {
    scannedWindowHours: L2_SCAN_WINDOW_HOURS,
    candidatesFound: candidates.length,
    flagged,
    alreadyFlagged,
  }
}
