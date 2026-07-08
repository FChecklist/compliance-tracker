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
} from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, isNull, inArray, desc, sql } from "drizzle-orm"
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

  const currentProgress = existing?.progressValue ?? 0
  const newProgress = currentProgress + incrementBy

  // Already unlocked -- keep incrementing progress (e.g. for display) but
  // never re-award points or overwrite unlockedAt.
  if (existing?.unlockedAt) {
    await db
      .update(veriRewardAchievementUnlocks)
      .set({ progressValue: newProgress, updatedAt: new Date() })
      .where(eq(veriRewardAchievementUnlocks.id, existing.id))
    return { unlocked: false, achievementDefinitionId: def.id, pointsAwarded: 0 }
  }

  const reachesTarget = newProgress >= targetValue

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

/** Most recent ledger movements for a user's activity feed. */
export async function listPointsHistory(db: TenantDb, orgId: string, userId: string, limit = 20) {
  return db
    .select()
    .from(veriRewardPointsLedger)
    .where(and(eq(veriRewardPointsLedger.orgId, orgId), eq(veriRewardPointsLedger.userId, userId)))
    .orderBy(desc(veriRewardPointsLedger.createdAt))
    .limit(limit)
}

/** Org-wide points ranking for the HR/team leaderboard surface. */
export async function getOrgLeaderboard(db: TenantDb, orgId: string, limit = 10) {
  const balanceExpr = sql<number>`coalesce(sum(${veriRewardPointsLedger.delta}), 0)::int`
  const rows = await db
    .select({ userId: veriRewardPointsLedger.userId, balance: balanceExpr })
    .from(veriRewardPointsLedger)
    .where(eq(veriRewardPointsLedger.orgId, orgId))
    .groupBy(veriRewardPointsLedger.userId)
    .orderBy(desc(balanceExpr))
    .limit(limit)

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
