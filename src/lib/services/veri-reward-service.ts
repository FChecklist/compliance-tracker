// VERI Treasure -- points + achievement + streak + referral engine (Wave 113).
// Schema (5 tables) lives in src/lib/db/schema.ts and the
// 0092_veri_reward.sql migration; this service only reads/writes them.
import {
  db,
  veriRewardPointsLedger,
  veriRewardAchievementDefinitions,
  veriRewardAchievementUnlocks,
  veriRewardStreaks,
  veriRewardReferrals,
  users,
  notifications,
} from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, isNull, inArray, desc, gte, lte, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"

export type AwardPointsParams = {
  orgId: string
  userId: string
  delta: number
  sourceType: string
  sourceId?: string
  reason?: string
  createdById?: string
}

/**
 * Append a single points-movement row to the ledger. Nothing fancier --
 * balances are derived via getPointsBalance() by summing `delta`.
 */
export async function awardPoints(db: TenantDb, params: AwardPointsParams): Promise<void> {
  const { orgId, userId, delta, sourceType, sourceId, reason, createdById } = params
  await db.insert(veriRewardPointsLedger).values({
    orgId,
    userId,
    delta,
    sourceType,
    sourceId: sourceId ?? null,
    reason: reason ?? null,
    createdById: createdById ?? null,
  })
}

/**
 * Sum of all ledger `delta` rows for this org+user. Mirrors the
 * `sql<number>\`count(*)::int\`` aggregate style used throughout
 * compliance-service.ts.
 */
export async function getPointsBalance(
  db: TenantDb,
  orgId: string,
  userId: string
): Promise<number> {
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${veriRewardPointsLedger.delta}), 0)::int` })
    .from(veriRewardPointsLedger)
    .where(
      and(
        eq(veriRewardPointsLedger.orgId, orgId),
        eq(veriRewardPointsLedger.userId, userId)
      )
    )
  return row?.balance ?? 0
}

export type CheckAndUnlockParams = {
  orgId: string
  userId: string
  achievementKey: string
  incrementBy?: number
}

export type UnlockResult = {
  unlocked: boolean
  achievementDefinitionId: string
  pointsAwarded: number
}

export type AchievementProgressInput = {
  currentProgress: number
  alreadyUnlocked: boolean
  incrementBy: number
  targetValue: number
}

export type AchievementProgressResult = {
  newProgress: number
  justUnlocked: boolean
}

/**
 * Pure business-rule core of checkAndUnlockAchievements(): given a user's
 * current progress on an achievement and how much this event increments it,
 * decide the new progress value and whether this specific call is the one
 * that crosses the unlock threshold. Extracted as a pure function (no DB,
 * no Date) so the threshold comparison itself is independently unit-testable
 * against real progress data -- see veri-reward-service.test.ts -- matching
 * this repo's own established convention of testing pure predicates rather
 * than DB-backed functions directly (crm-service.test.ts's own header note).
 *
 * `justUnlocked` is true only on the exact call that crosses the threshold
 * for the first time: once `alreadyUnlocked` is true, progress keeps
 * incrementing (for display) but `justUnlocked` is always false -- points
 * must never be re-awarded and unlockedAt must never be overwritten.
 */
export function evaluateAchievementProgress(input: AchievementProgressInput): AchievementProgressResult {
  const { currentProgress, alreadyUnlocked, incrementBy, targetValue } = input
  const newProgress = currentProgress + incrementBy
  if (alreadyUnlocked) return { newProgress, justUnlocked: false }
  return { newProgress, justUnlocked: newProgress >= targetValue }
}

/**
 * Looks up the achievement definition for `achievementKey` using the
 * codebase's standard most-specific-scope-wins pattern: an org-specific
 * override (org_id = orgId) wins over the platform-default row
 * (org_id IS NULL). Increments the user's progress on the matching
 * achievement unlock row and, if the target is reached for the first
 * time, marks it unlocked and awards the definition's pointsReward.
 *
 * Returns null when no definition exists for the key; otherwise an
 * UnlockResult describing whether this call crossed the threshold.
 */
export async function checkAndUnlockAchievements(
  db: TenantDb,
  params: CheckAndUnlockParams
): Promise<UnlockResult | null> {
  const { orgId, userId, achievementKey, incrementBy = 1 } = params

  // Most-specific-scope-wins: prefer an org-scoped override, fall back to
  // the platform default (org_id IS NULL). Only active definitions count.
  const [orgOverride] = await db
    .select()
    .from(veriRewardAchievementDefinitions)
    .where(
      and(
        eq(veriRewardAchievementDefinitions.orgId, orgId),
        eq(veriRewardAchievementDefinitions.achievementKey, achievementKey),
        eq(veriRewardAchievementDefinitions.isActive, true)
      )
    )
    .limit(1)

  const [platformDefault] = await db
    .select()
    .from(veriRewardAchievementDefinitions)
    .where(
      and(
        isNull(veriRewardAchievementDefinitions.orgId),
        eq(veriRewardAchievementDefinitions.achievementKey, achievementKey),
        eq(veriRewardAchievementDefinitions.isActive, true)
      )
    )
    .limit(1)

  const def = orgOverride ?? platformDefault
  if (!def) return null

  const targetValue = def.targetValue
  const pointsReward = def.pointsReward

  // Find the user's existing progress row (if any) for this definition.
  const [existing] = await db
    .select()
    .from(veriRewardAchievementUnlocks)
    .where(
      and(
        eq(veriRewardAchievementUnlocks.userId, userId),
        eq(veriRewardAchievementUnlocks.achievementDefinitionId, def.id)
      )
    )
    .limit(1)

  const { newProgress, justUnlocked: reachesTarget } = evaluateAchievementProgress({
    currentProgress: existing?.progressValue ?? 0,
    alreadyUnlocked: existing?.unlockedAt != null,
    incrementBy,
    targetValue,
  })

  // Already unlocked -- keep incrementing progress (e.g. for display) but
  // never re-award points or overwrite unlockedAt.
  if (existing?.unlockedAt) {
    await db
      .update(veriRewardAchievementUnlocks)
      .set({ progressValue: newProgress, updatedAt: new Date() })
      .where(eq(veriRewardAchievementUnlocks.id, existing.id))
    return { unlocked: false, achievementDefinitionId: def.id, pointsAwarded: 0 }
  }

  if (!existing) {
    await db.insert(veriRewardAchievementUnlocks).values({
      orgId,
      userId,
      achievementDefinitionId: def.id,
      progressValue: newProgress,
      unlockedAt: reachesTarget ? new Date() : null,
    })
  } else {
    await db
      .update(veriRewardAchievementUnlocks)
      .set({
        progressValue: newProgress,
        unlockedAt: reachesTarget ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(veriRewardAchievementUnlocks.id, existing.id))
  }

  if (reachesTarget) {
    await awardPoints(db, {
      orgId,
      userId,
      delta: pointsReward,
      sourceType: "achievement_unlock",
      sourceId: def.id,
      reason: `Achievement unlocked: ${def.displayName}`,
    })
    // Real-time trigger at the moment of unlock, not just a passive /rewards
    // page state -- an achievement can unlock from any of the module's wired
    // call sites (documents, compliance, onboarding, auth), most of which
    // have no UI of their own to show a toast in. Writing a real
    // notifications row (same insert-directly convention every other module
    // uses -- see compliance-service.ts's status_change/assignment inserts)
    // means the existing topbar bell surfaces it regardless of which screen
    // the user is actually on when the threshold is crossed. Wrapped so a
    // notification-write failure can never break the actual unlock/award --
    // same discipline as recordStreakCheckIn's own achievement-check guard.
    try {
      await db.insert(notifications).values({
        userId,
        title: `Achievement unlocked: ${def.displayName}`,
        message: `You earned +${pointsReward} points for "${def.displayName}".`,
        type: "system",
        metadata: { achievementDefinitionId: def.id, achievementKey: def.achievementKey, pointsAwarded: pointsReward },
      })
    } catch (err) {
      console.error("[veri-reward] failed to write achievement-unlock notification", err)
    }
    return { unlocked: true, achievementDefinitionId: def.id, pointsAwarded: pointsReward }
  }

  return { unlocked: false, achievementDefinitionId: def.id, pointsAwarded: 0 }
}

/**
 * Every achievement visible to this org (platform defaults, minus any that
 * an org-specific override replaces -- same most-specific-scope-wins rule
 * as checkAndUnlockAchievements), joined with this user's progress.
 */
export async function listAchievementsWithProgress(db: TenantDb, orgId: string, userId: string) {
  const defs = await db
    .select()
    .from(veriRewardAchievementDefinitions)
    .where(
      and(
        sql`(${veriRewardAchievementDefinitions.orgId} = ${orgId} OR ${veriRewardAchievementDefinitions.orgId} IS NULL)`,
        eq(veriRewardAchievementDefinitions.isActive, true)
      )
    )

  const byKey = new Map<string, typeof defs[number]>()
  for (const def of defs) {
    // Platform defaults are visited in the same query without ordering
    // guarantees, so always let an org-scoped row win regardless of
    // iteration order.
    const existing = byKey.get(def.achievementKey)
    if (!existing || (existing.orgId === null && def.orgId !== null)) byKey.set(def.achievementKey, def)
  }
  const resolved = Array.from(byKey.values())
  if (resolved.length === 0) return []

  const unlocks = await db
    .select()
    .from(veriRewardAchievementUnlocks)
    .where(and(eq(veriRewardAchievementUnlocks.orgId, orgId), eq(veriRewardAchievementUnlocks.userId, userId)))
  const progressByDefId = new Map(unlocks.map((u) => [u.achievementDefinitionId, u]))

  return resolved.map((def) => {
    const progress = progressByDefId.get(def.id)
    return {
      achievementKey: def.achievementKey,
      context: def.context,
      displayName: def.displayName,
      description: def.description,
      icon: def.icon,
      targetValue: def.targetValue,
      pointsReward: def.pointsReward,
      progressValue: progress?.progressValue ?? 0,
      unlockedAt: progress?.unlockedAt?.toISOString() ?? null,
    }
  })
}

export type PointsHistoryFilter = {
  limit?: number
  offset?: number
  startDate?: Date
  endDate?: Date
}

/**
 * Ledger movements for a user's activity feed / CSV export, newest first.
 * `offset` supports simple page-through pagination; `startDate`/`endDate`
 * (inclusive, on createdAt) support the date-range filtering the /rewards
 * page's history list previously had none of.
 */
export async function listPointsHistory(db: TenantDb, orgId: string, userId: string, filter: PointsHistoryFilter = {}) {
  const { limit = 20, offset = 0, startDate, endDate } = filter
  const conditions = [eq(veriRewardPointsLedger.orgId, orgId), eq(veriRewardPointsLedger.userId, userId)]
  if (startDate) conditions.push(gte(veriRewardPointsLedger.createdAt, startDate))
  if (endDate) conditions.push(lte(veriRewardPointsLedger.createdAt, endDate))

  return db
    .select()
    .from(veriRewardPointsLedger)
    .where(and(...conditions))
    .orderBy(desc(veriRewardPointsLedger.createdAt))
    .limit(limit)
    .offset(offset)
}

/** Total ledger row count for a user, matching the same filter listPointsHistory() uses -- lets a caller compute "page N of M" / "has more". */
export async function countPointsHistory(db: TenantDb, orgId: string, userId: string, filter: Pick<PointsHistoryFilter, "startDate" | "endDate"> = {}) {
  const { startDate, endDate } = filter
  const conditions = [eq(veriRewardPointsLedger.orgId, orgId), eq(veriRewardPointsLedger.userId, userId)]
  if (startDate) conditions.push(gte(veriRewardPointsLedger.createdAt, startDate))
  if (endDate) conditions.push(lte(veriRewardPointsLedger.createdAt, endDate))

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(veriRewardPointsLedger)
    .where(and(...conditions))
  return row?.count ?? 0
}

/** Org-wide points ranking for the HR/team leaderboard surface. `offset` supports pagination past the top page. */
export async function getOrgLeaderboard(db: TenantDb, orgId: string, limit = 10, offset = 0) {
  const balanceExpr = sql<number>`coalesce(sum(${veriRewardPointsLedger.delta}), 0)::int`
  const rows = await db
    .select({ userId: veriRewardPointsLedger.userId, balance: balanceExpr })
    .from(veriRewardPointsLedger)
    .where(eq(veriRewardPointsLedger.orgId, orgId))
    .groupBy(veriRewardPointsLedger.userId)
    .orderBy(desc(balanceExpr))
    .limit(limit)
    .offset(offset)

  if (rows.length === 0) return []

  const userRows = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, rows.map((r) => r.userId)))
  const byId = new Map(userRows.map((u) => [u.id, u]))

  return rows.map((r) => ({
    userId: r.userId,
    balance: r.balance,
    name: byId.get(r.userId)?.name ?? "Unknown",
    avatarUrl: byId.get(r.userId)?.avatarUrl ?? null,
  }))
}

export type StreakResult = {
  streakKey: string
  currentCount: number
  longestCount: number
  graceAvailable: boolean
}

// Daily-cadence streak with a one-day grace window (anti-dark-pattern design
// choice, see veriRewardStreaks's own schema comment): a single missed day
// holds the streak via graceUsedAt rather than zeroing it immediately, but
// a second consecutive miss (or a second miss before a new increment resets
// the grace allowance) resets currentCount to 1. Calendar-day granularity
// in UTC -- a deliberate simplification, not per-org-timezone-aware yet.
function dayFloor(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000)
}

export async function recordStreakCheckIn(db: TenantDb, orgId: string, userId: string, streakKey: string): Promise<StreakResult> {
  const [existing] = await db
    .select()
    .from(veriRewardStreaks)
    .where(and(eq(veriRewardStreaks.orgId, orgId), eq(veriRewardStreaks.userId, userId), eq(veriRewardStreaks.streakKey, streakKey)))
    .limit(1)

  const now = new Date()
  const today = dayFloor(now)

  if (!existing) {
    await db.insert(veriRewardStreaks).values({
      orgId, userId, streakKey, currentCount: 1, longestCount: 1, lastIncrementedAt: now,
    })
    return { streakKey, currentCount: 1, longestCount: 1, graceAvailable: true }
  }

  const lastDay = existing.lastIncrementedAt ? dayFloor(existing.lastIncrementedAt) : null
  const gapDays = lastDay === null ? Infinity : today - lastDay

  // Already checked in today -- idempotent, no double-increment.
  if (gapDays === 0) {
    return {
      streakKey,
      currentCount: existing.currentCount,
      longestCount: existing.longestCount,
      graceAvailable: existing.graceUsedAt === null,
    }
  }

  let currentCount: number
  let graceUsedAt: Date | null = existing.graceUsedAt

  if (gapDays === 1) {
    // Consecutive day -- normal increment. A fresh increment re-arms the
    // grace allowance for the next cycle.
    currentCount = existing.currentCount + 1
    graceUsedAt = null
  } else if (gapDays === 2 && existing.graceUsedAt === null) {
    // Exactly one day missed, and grace hasn't been spent yet this cycle --
    // the streak holds instead of resetting.
    currentCount = existing.currentCount + 1
    graceUsedAt = now
  } else {
    // 2+ consecutive misses, or grace already spent -- genuine reset.
    currentCount = 1
    graceUsedAt = null
  }

  const longestCount = Math.max(existing.longestCount, currentCount)

  await db.update(veriRewardStreaks)
    .set({ currentCount, longestCount, lastIncrementedAt: now, graceUsedAt, updatedAt: now })
    .where(eq(veriRewardStreaks.id, existing.id))

  // VERI Reward: nudge the 'login_streak_3' achievement the moment the
  // daily_login streak reaches 3 days. Only fires on the exact threshold
  // crossing (not every day after) -- checkAndUnlockAchievements' own
  // unlockedAt guard makes repeat calls harmless anyway, but gating here
  // avoids pointless extra writes once the streak is well past 3. Wrapped
  // so a points-engine failure can never break the actual streak check-in
  // (logged, not thrown) -- same discipline as compliance-service.ts's
  // first_compliance_item wiring.
  if (streakKey === "daily_login" && currentCount === 3) {
    try {
      await checkAndUnlockAchievements(db, { orgId, userId, achievementKey: "login_streak_3" })
    } catch (err) {
      console.error("[veri-reward] failed to check login_streak_3 achievement", err)
    }
  }

  return { streakKey, currentCount, longestCount, graceAvailable: graceUsedAt === null }
}

export async function listStreaks(db: TenantDb, orgId: string, userId: string) {
  return db.select().from(veriRewardStreaks).where(and(eq(veriRewardStreaks.orgId, orgId), eq(veriRewardStreaks.userId, userId)))
}

// ─── Refer-and-earn (points-only -- Boss decision 2026-07-08: no cash
// bridge into sales-engine-service.ts's commission machinery for now) ─────
//
// Reuses the Sales Engine's proven state-machine SHAPE (clicked ->
// signup_completed -> org_provisioned -> paid -> lost), never its tables --
// this is org-scoped/RLS-protected (real end users), unlike sales_referrals
// (platform-owned, deliberately RLS-free, external B2B partners). See
// veriRewardReferrals's own schema comment for the full reasoning.
//
// Single-table design (unlike Sales Engine's link+referral split): one row
// IS the referrer's active share link for a given targetType until it's
// consumed by a real signup, at which point a fresh row is created for any
// further shares. clickCount increments on every visit to /vr/<token>.
export type ReferralTargetType = "customer_to_customer" | "veridian_growth"

const REFERRAL_POINTS_ON_SIGNUP = 100

export async function getOrCreateReferralLink(db: TenantDb, orgId: string, referrerUserId: string, targetType: ReferralTargetType) {
  const [existing] = await db
    .select()
    .from(veriRewardReferrals)
    .where(
      and(
        eq(veriRewardReferrals.orgId, orgId),
        eq(veriRewardReferrals.referrerUserId, referrerUserId),
        eq(veriRewardReferrals.targetType, targetType),
        isNull(veriRewardReferrals.referredOrgId)
      )
    )
    .limit(1)
  if (existing) return existing

  const [created] = await db.insert(veriRewardReferrals).values({
    orgId,
    referrerUserId,
    referralToken: createId(),
    targetType,
  }).returning()
  return created
}

export async function listMyReferrals(db: TenantDb, orgId: string, referrerUserId: string) {
  return db
    .select()
    .from(veriRewardReferrals)
    .where(and(eq(veriRewardReferrals.orgId, orgId), eq(veriRewardReferrals.referrerUserId, referrerUserId)))
    .orderBy(desc(veriRewardReferrals.createdAt))
}

// Public, pre-auth -- called from /vr/[token]'s redirect route, mirrors
// sales-engine-service.ts's resolveReferralLinkAndRecordClick exactly
// (raw db, no tenant context: an anonymous visitor has no org yet).
export async function recordReferralClick(referralToken: string) {
  const referral = await db.query.veriRewardReferrals.findFirst({ where: eq(veriRewardReferrals.referralToken, referralToken) })
  if (!referral) return null

  const now = new Date()
  await db.update(veriRewardReferrals)
    .set({ clickCount: sql`${veriRewardReferrals.clickCount} + 1`, clickedAt: referral.clickedAt ?? now })
    .where(eq(veriRewardReferrals.id, referral.id))
  return referral
}

// Called from autoProvisionUser() at signup+org-creation time, same timing
// as sales-engine-service.ts's recordReferralSignupAndOrgProvisioned. Raw
// db (the new signup's org doesn't exist in any tenant context yet when
// this resolves the referral row) -- awarding points to the REFERRER
// happens separately via awardPoints() once their orgId is known, so that
// write stays tenant-scoped. Fails silently (returns null) on a stale/
// invalid token -- this must never block a real signup.
export async function recordReferralSignupCompleted(input: {
  refToken: string
  referredUserId: string
  referredOrgId: string
}) {
  const referral = await db.query.veriRewardReferrals.findFirst({
    where: and(eq(veriRewardReferrals.referralToken, input.refToken), isNull(veriRewardReferrals.referredOrgId)),
  })
  if (!referral) return null

  const now = new Date()
  const [updated] = await db.update(veriRewardReferrals).set({
    status: "org_provisioned",
    referredOrgId: input.referredOrgId,
    referredUserId: input.referredUserId,
    rewardPoints: REFERRAL_POINTS_ON_SIGNUP,
    signupCompletedAt: now,
    orgProvisionedAt: now,
  }).where(eq(veriRewardReferrals.id, referral.id)).returning()

  return updated
}

// ─── Admin engagement report ─────────────────────────────────────────────
// VERIDIAN Review Framework gap-closure (task-20260718-083002): "Reporting &
// Export Accuracy" -- listPointsHistory()/getOrgLeaderboard() only ever
// powered per-user UI cards; there was no admin-facing rollup of how the
// module is doing across the whole org. Read-only aggregate, org-scoped
// (RLS-protected, same tenant boundary as every other query in this file) --
// see requireVeriRewardAdminReportAccess() at the API route layer for the
// admin/manager role gate (this function itself does no role check, matching
// every other function in this file -- authorization is the route's job).
export type VeriRewardEngagementReport = {
  totalPointsAwarded: number // sum of positive ledger deltas
  totalPointsRedeemed: number // sum of |negative ledger deltas|
  netPointsBalance: number
  achievementDefinitionsCount: number // distinct achievements visible to this org
  achievementUnlocksCount: number // unlock rows with unlockedAt set
  achievementUnlockRate: number // unlocksCount / (activeUserCount * definitionsCount), 0 if either is 0
  activeUserCount: number // distinct users with at least one ledger row
  referralsCreatedCount: number
  referralsConvertedCount: number // status = 'org_provisioned' or 'paid'
  referralConversionRate: number // convertedCount / createdCount, 0 if createdCount is 0
}

export async function getEngagementReport(db: TenantDb, orgId: string): Promise<VeriRewardEngagementReport> {
  const [pointsRow] = await db
    .select({
      awarded: sql<number>`coalesce(sum(case when ${veriRewardPointsLedger.delta} > 0 then ${veriRewardPointsLedger.delta} else 0 end), 0)::int`,
      redeemed: sql<number>`coalesce(sum(case when ${veriRewardPointsLedger.delta} < 0 then -${veriRewardPointsLedger.delta} else 0 end), 0)::int`,
      activeUsers: sql<number>`count(distinct ${veriRewardPointsLedger.userId})::int`,
    })
    .from(veriRewardPointsLedger)
    .where(eq(veriRewardPointsLedger.orgId, orgId))

  const [defCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(veriRewardAchievementDefinitions)
    .where(
      and(
        sql`(${veriRewardAchievementDefinitions.orgId} = ${orgId} OR ${veriRewardAchievementDefinitions.orgId} IS NULL)`,
        eq(veriRewardAchievementDefinitions.isActive, true)
      )
    )

  const [unlockCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(veriRewardAchievementUnlocks)
    .where(and(eq(veriRewardAchievementUnlocks.orgId, orgId), sql`${veriRewardAchievementUnlocks.unlockedAt} IS NOT NULL`))

  const [referralRow] = await db
    .select({
      created: sql<number>`count(*)::int`,
      converted: sql<number>`count(*) filter (where ${veriRewardReferrals.status} in ('org_provisioned', 'paid'))::int`,
    })
    .from(veriRewardReferrals)
    .where(eq(veriRewardReferrals.orgId, orgId))

  const totalPointsAwarded = pointsRow?.awarded ?? 0
  const totalPointsRedeemed = pointsRow?.redeemed ?? 0
  const activeUserCount = pointsRow?.activeUsers ?? 0
  const achievementDefinitionsCount = defCountRow?.count ?? 0
  const achievementUnlocksCount = unlockCountRow?.count ?? 0
  const referralsCreatedCount = referralRow?.created ?? 0
  const referralsConvertedCount = referralRow?.converted ?? 0

  const unlockDenominator = activeUserCount * achievementDefinitionsCount
  const achievementUnlockRate = unlockDenominator > 0 ? achievementUnlocksCount / unlockDenominator : 0
  const referralConversionRate = referralsCreatedCount > 0 ? referralsConvertedCount / referralsCreatedCount : 0

  return {
    totalPointsAwarded,
    totalPointsRedeemed,
    netPointsBalance: totalPointsAwarded - totalPointsRedeemed,
    achievementDefinitionsCount,
    achievementUnlocksCount,
    achievementUnlockRate,
    activeUserCount,
    referralsCreatedCount,
    referralsConvertedCount,
    referralConversionRate,
  }
}
