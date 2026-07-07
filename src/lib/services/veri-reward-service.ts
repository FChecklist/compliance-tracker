// VERI Reward -- points + achievement engine (Wave 113).
// Schema (5 tables) lives in src/lib/db/schema.ts and the
// 0092_veri_reward.sql migration; this service only reads/writes them.
// Streaks + referrals are intentionally NOT wired here (separate task).
import {
  veriRewardPointsLedger,
  veriRewardAchievementDefinitions,
  veriRewardAchievementUnlocks,
} from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, isNull, sql } from "drizzle-orm"

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
