// Continuous Internal Controls Monitoring -- L3 Rolling Health Audit
// (VERIDIAN Review Framework gap closure, 2026-07-18). CONSTITUTION.yaml's
// AUDIT-03 7-level cadence had L1 (Real-Time, per-task) genuinely enforced,
// but L2-L7 were all either PARTIALLY_ENFORCED or POLICY_ONLY with the same
// stated gap: "no aggregate query/report exists." This is that smallest
// next increment, per that entry's own note -- an aggregate query over a
// rolling time window, not a new per-task check (L1 already owns that).
//
// Deliberately scoped to signals THIS PR's own Automatic Rollback &
// Recovery work made real and queryable, rather than inventing a broader
// "system health" concept with nothing real behind it yet:
//   - compensatingVoids: how often voidDraftJournalEntry
//     (erp-accounting-service.ts) had to fire -- each one means a
//     multi-step financial posting failed partway through and needed an
//     automatic rollback. A rolling window of zero is healthy; a rising
//     count is a real signal something downstream is failing repeatedly.
//   - orphanedApprovals: approval_workflow_instance.finalization_failed
//     events (approval-workflows/steps/[id]/decide/route.ts) -- an approval
//     decision that was recorded but whose entity never actually got
//     finalized, even after one automatic retry. Each one is a genuine
//     stuck record needing a human to intervene.
//
// Honest limitation: no automated schedule triggers this on a 30-60min
// cadence today. This repo is already at the Vercel Hobby plan's
// once-per-day cron ceiling (see ai-os/MASTER-TRACKER.yaml's own prior note
// on the same constraint, and audit-cadence.ts's L5/L6/L7 collapsing to the
// same daily slot for the identical reason) -- adding a new cron was a
// deliberate, separate decision this pass did not make. Exposed as an
// on-demand, veridian_admin-gated route instead (GET /api/ai/team/
// controls-health), the same accepted pattern the review-registry route
// already established for this exact constraint.
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { auditLogs } from "@/lib/db"
import { and, eq, gte, inArray, sql } from "drizzle-orm"

const COMPENSATING_VOID_ACTION = "erp_journal_entry.voided_compensating"
const ORPHANED_APPROVAL_ACTION = "approval_workflow_instance.finalization_failed"
const WATCHED_ACTIONS: string[] = [COMPENSATING_VOID_ACTION, ORPHANED_APPROVAL_ACTION]

const MIN_WINDOW_MINUTES = 30
const MAX_WINDOW_MINUTES = 60

export type ControlsHealthEvent = { action: string; entityType: string; entityId: string; details: string | null; createdAt: string }

export type ControlsHealthSnapshot = {
  windowMinutes: number
  since: string
  compensatingVoids: number
  orphanedApprovals: number
  recentEvents: ControlsHealthEvent[]
  status: "healthy" | "attention_needed"
}

/**
 * Pure aggregate query -- no LLM call, matching this codebase's existing
 * monitoring-engine.ts discipline of deterministic scoring over real,
 * already-persisted data. `windowMinutes` is clamped to the 30-60 range
 * named by CONSTITUTION.yaml's own L3 cadence entry, not left unbounded.
 */
export async function getControlsHealthSnapshot(orgId: string, windowMinutes = 60): Promise<ControlsHealthSnapshot> {
  const clampedMinutes = Math.min(MAX_WINDOW_MINUTES, Math.max(MIN_WINDOW_MINUTES, windowMinutes))
  const since = new Date(Date.now() - clampedMinutes * 60_000)

  const rows = await withTenantContext({ orgId }, (db) =>
    db.select({
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
      createdAt: auditLogs.createdAt,
    })
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, orgId), gte(auditLogs.createdAt, since), inArray(auditLogs.action, WATCHED_ACTIONS)))
      .orderBy(sql`${auditLogs.createdAt} desc`)
      .limit(200)
  )

  const compensatingVoids = rows.filter((r) => r.action === COMPENSATING_VOID_ACTION).length
  const orphanedApprovals = rows.filter((r) => r.action === ORPHANED_APPROVAL_ACTION).length

  return {
    windowMinutes: clampedMinutes,
    since: since.toISOString(),
    compensatingVoids,
    orphanedApprovals,
    recentEvents: rows.map((r) => ({ action: r.action, entityType: r.entityType, entityId: r.entityId, details: r.details, createdAt: r.createdAt.toISOString() })),
    // orphanedApprovals is the one signal here that always needs a human to
    // resolve (nothing else will retry it) -- any count above zero flips
    // status. compensatingVoids alone does not, since the automatic
    // recovery it represents already succeeded at keeping the ledger clean.
    status: orphanedApprovals > 0 ? "attention_needed" : "healthy",
  }
}
