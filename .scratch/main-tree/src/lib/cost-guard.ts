// Wave 172 (area 11, Cost management -- embedded in U-D14.B1.S1): active
// spend CONTROL on top of token-usage-service.ts's existing observability
// (which only ever reported what got spent, never stopped anything).
// Scope decision made by Super Boss per the Owner's 2026-07-11 "don't wait"
// directive -- see organisations.monthlyCostCapUsd's schema comment for the
// full rationale (per-org, monthly, opt-in). Checked against scope=
// 'product_orchestra' rows only: 'ai_team_internal' spend is platform-owned
// (orgId is null for those rows by design, see token-usage-service.ts) and
// out of scope for a per-org cap.
import { db, tokenUsageLedger, organisations, users, notifications } from "@/lib/db"
import { eq, and, gte, isNotNull, inArray } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { buildSpendForecast } from "@/lib/spend-forecast"

export interface CostStatus {
  monthlyCostCapUsd: number | null
  currentSpendUsd: number
  spendRemainingUsd: number | null
  enforcementEnabled: boolean
  isOverLimit: boolean
  isNearLimit: boolean
  // AI Cost Governance & FinOps gap-closure (2026-07-18): "forecasted vs
  // actual monthly AI spend" -- simple linear run-rate projection (see
  // spend-forecast.ts), surfaced next to currentSpendUsd in
  // OrgLimitsSection.tsx so an org admin can see whether they're on pace to
  // exceed their own cap before the month actually ends, not just after.
  forecastedMonthEndSpendUsd: number
}

const NEAR_LIMIT_THRESHOLD = 0.8

function startOfCurrentMonthUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function getMonthlySpend(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float` })
    .from(tokenUsageLedger)
    .where(and(
      eq(tokenUsageLedger.orgId, orgId),
      eq(tokenUsageLedger.scope, "product_orchestra"),
      gte(tokenUsageLedger.createdAt, startOfCurrentMonthUtc()),
    ))
  return row?.total ?? 0
}

export async function getCostStatus(orgId: string): Promise<CostStatus> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  const monthlyCostCapUsd = org?.monthlyCostCapUsd !== null && org?.monthlyCostCapUsd !== undefined ? Number(org.monthlyCostCapUsd) : null
  const enforcementEnabled = org?.costCapEnforcementEnabled ?? false
  const currentSpendUsd = await getMonthlySpend(orgId)
  const spendRemainingUsd = monthlyCostCapUsd === null ? null : Math.max(0, monthlyCostCapUsd - currentSpendUsd)
  const isOverLimit = enforcementEnabled && monthlyCostCapUsd !== null && currentSpendUsd >= monthlyCostCapUsd
  const isNearLimit = enforcementEnabled && monthlyCostCapUsd !== null && currentSpendUsd >= monthlyCostCapUsd * NEAR_LIMIT_THRESHOLD
  const forecastedMonthEndSpendUsd = buildSpendForecast(currentSpendUsd, new Date()).forecastedMonthEndSpendUsd
  return { monthlyCostCapUsd, currentSpendUsd, spendRemainingUsd, enforcementEnabled, isOverLimit, isNearLimit, forecastedMonthEndSpendUsd }
}

export async function canIncurCost(orgId: string): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const status = await getCostStatus(orgId)
  if (!status.isOverLimit) return { allowed: true }
  return {
    allowed: false,
    reason: `This organisation has reached its monthly AI spend cap of $${status.monthlyCostCapUsd?.toFixed(2)} (current spend: $${status.currentSpendUsd.toFixed(2)}). An admin must raise the cap or wait for next month's reset before further AI usage is available.`,
  }
}

export async function setCostCap(orgId: string, monthlyCostCapUsd: number | null, enforcementEnabled: boolean): Promise<void> {
  await db.update(organisations)
    .set({ monthlyCostCapUsd: monthlyCostCapUsd === null ? null : String(monthlyCostCapUsd), costCapEnforcementEnabled: enforcementEnabled })
    .where(eq(organisations.id, orgId))
}

// Gap-closure (VERIDIAN Review Framework, AI Cost Governance & FinOps,
// 2026-07-18): canIncurCost() already blocks further spend once an org
// crosses its cap, but that's a reactive gate an admin only discovers by
// hitting it (or by opening /api/settings/org-limits and checking). Nothing
// pushed a signal out before then -- a genuine "requires an admin to check a
// page" gap. Reuses metric-alert-service.ts's own established alerting
// shape rather than inventing a new one: a pure classify function (mirrors
// that file's `compare()`), a notify-on-breach pass driven by the same
// daily /api/internal/metric-alerts/run cron entry point (see that route's
// Promise.all -- ticket SLAs and task overdue checks already share this one
// scheduled job the same way), and the existing `notifications` table/
// insert shape (type: "system", metadata carrying the identifiers a click-
// through would need). Deliberately re-notifies every run while the breach
// persists rather than tracking "already notified" state, matching
// checkTicketSlaBreaches/checkTaskOverdue's own existing precedent in this
// codebase (no dedup column on those either) -- consistent daily cadence
// (see vercel.json), not a new spam vector.
export function classifyCostBreach(status: Pick<CostStatus, "isOverLimit" | "isNearLimit">): "over" | "near" | "none" {
  if (status.isOverLimit) return "over"
  if (status.isNearLimit) return "near"
  return "none"
}

export async function checkCostCeilingBreaches(): Promise<{ checked: number; overLimit: number; nearLimit: number }> {
  const orgs = await db.query.organisations.findMany({
    where: and(eq(organisations.costCapEnforcementEnabled, true), isNotNull(organisations.monthlyCostCapUsd)),
  })

  let overLimit = 0
  let nearLimit = 0

  for (const org of orgs) {
    try {
      const status = await getCostStatus(org.id)
      const breach = classifyCostBreach(status)
      if (breach === "none") continue
      if (breach === "over") overLimit++
      else nearLimit++

      // Notified set matches /api/settings/org-limits' own PATCH gate
      // (admin or manager can change the cap) -- the people who can
      // actually act on this alert, not every org member.
      const recipients = await db.query.users.findMany({
        where: and(eq(users.orgId, org.id), inArray(users.role, ["admin", "manager"])),
      })

      const title = breach === "over"
        ? `AI spend cap reached: ${org.name}`
        : `AI spend approaching cap: ${org.name}`
      const message = breach === "over"
        ? `${org.name} has reached its monthly AI spend cap of $${status.monthlyCostCapUsd?.toFixed(2)} (current spend: $${status.currentSpendUsd.toFixed(2)}). Further AI usage is blocked until the cap is raised or the month resets.`
        : `${org.name} has used $${status.currentSpendUsd.toFixed(2)} of its $${status.monthlyCostCapUsd?.toFixed(2)} monthly AI spend cap (${Math.round((status.currentSpendUsd / (status.monthlyCostCapUsd ?? 1)) * 100)}%).`

      for (const recipient of recipients) {
        await db.insert(notifications).values({
          userId: recipient.id,
          title,
          message,
          type: "system",
          metadata: { orgId: org.id, breach, monthlyCostCapUsd: status.monthlyCostCapUsd, currentSpendUsd: status.currentSpendUsd },
        })
      }
    } catch (err) {
      console.error(`Cost ceiling check failed for org ${org.id}:`, err)
    }
  }

  return { checked: orgs.length, overLimit, nearLimit }
}
