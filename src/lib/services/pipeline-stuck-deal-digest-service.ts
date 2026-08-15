// VERIDIAN Review Framework gap-closure: Sales Pipeline (task-20260718-
// 082004, 2026-08-07), "Notification & Alert Trigger Correctness" finding
// ("deal stuck in stage X for 30 days"). Confirmed absent before this wave:
// grepped src/ for any pipeline-specific notification trigger -- zero
// hits. Mirrors task-nudge-digest-service.ts's exact shape (platform-wide
// scheduled scan, one batched notification per owner, zero LLM call) --
// deliberately NOT reusing crm-service.ts#listStuckOpportunities, which is
// org-scoped (goes through withTenantContext/RLS, correct for a
// session-driven UI read). This is a platform-wide cron job scanning every
// org in one pass, same posture as task-nudge-digest-service.ts and
// metric-alert-service.ts's evaluateAllMetricAlertRules() -- both query the
// plain `db` export directly rather than looping withTenantContext per org.
import { db, crmOpportunities, crmStageHistory, notifications } from "@/lib/db"
import { and, eq, ne, inArray } from "drizzle-orm"

const STUCK_THRESHOLD_DAYS = 30

export type StuckDealRow = { id: string; orgId: string; name: string; stage: string; ownerId: string; daysInStage: number }

/**
 * Pure: groups stuck deals by owner (one notification per owner, never one
 * per deal -- same noise-reduction posture as task-nudge-digest-service.ts's
 * groupTasksForNudge).
 */
export function groupStuckDealsByOwner(rows: StuckDealRow[]): Map<string, StuckDealRow[]> {
  const byOwner = new Map<string, StuckDealRow[]>()
  for (const row of rows) {
    const list = byOwner.get(row.ownerId) ?? []
    list.push(row)
    byOwner.set(row.ownerId, list)
  }
  return byOwner
}

/** Pure: the batched notification body for one owner's stuck deals. */
export function summarizeStuckDeals(deals: StuckDealRow[]): string {
  if (deals.length === 1) {
    const d = deals[0]
    return `"${d.name}" has been in ${d.stage} for ${d.daysInStage} days with no stage change.`
  }
  const maxDays = Math.max(...deals.map((d) => d.daysInStage))
  return `${deals.length} deals have been stuck in their current stage for ${STUCK_THRESHOLD_DAYS}+ days (longest: ${maxDays} days).`
}

export async function runPipelineStuckDealDigest(): Promise<{ ownersNotified: number; dealsCovered: number }> {
  const openOpportunities = await db.query.crmOpportunities.findMany({
    where: and(ne(crmOpportunities.stage, "won"), ne(crmOpportunities.stage, "lost")),
    columns: { id: true, orgId: true, name: true, stage: true, ownerId: true, createdAt: true },
  })
  const withOwner = openOpportunities.filter((o): o is typeof o & { ownerId: string } => o.ownerId !== null)
  if (withOwner.length === 0) return { ownersNotified: 0, dealsCovered: 0 }

  const history = await db.query.crmStageHistory.findMany({
    where: and(eq(crmStageHistory.entityType, "opportunity"), inArray(crmStageHistory.entityId, withOwner.map((o) => o.id))),
    orderBy: (t, { desc }) => desc(t.changedAt),
    columns: { entityId: true, changedAt: true },
  })
  const latestChangeByOpp = new Map<string, Date>()
  for (const h of history) if (!latestChangeByOpp.has(h.entityId)) latestChangeByOpp.set(h.entityId, h.changedAt)

  const now = Date.now()
  const stuck: StuckDealRow[] = []
  for (const o of withOwner) {
    const since = latestChangeByOpp.get(o.id) ?? o.createdAt
    const daysInStage = Math.floor((now - since.getTime()) / 86_400_000)
    if (daysInStage >= STUCK_THRESHOLD_DAYS) stuck.push({ id: o.id, orgId: o.orgId, name: o.name, stage: o.stage, ownerId: o.ownerId, daysInStage })
  }
  if (stuck.length === 0) return { ownersNotified: 0, dealsCovered: 0 }

  const grouped = groupStuckDealsByOwner(stuck)
  let ownersNotified = 0
  for (const [ownerId, deals] of grouped) {
    await db.insert(notifications).values({
      userId: ownerId,
      title: "Deals stuck in pipeline",
      message: summarizeStuckDeals(deals),
      type: "deadline_reminder",
      metadata: { kind: "pipeline_stuck_deal_digest", opportunityIds: deals.map((d) => d.id) },
    })
    ownersNotified++
  }
  return { ownersNotified, dealsCovered: stuck.length }
}
