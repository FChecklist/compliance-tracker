import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import {
  getPointsBalance,
  listPointsHistory,
  listAchievementsWithProgress,
  listStreaks,
} from "@/lib/services/veri-reward-service"
import { isVeriRewardEnabledForOrg } from "@/lib/services/veri-reward-enablement-service"

// Wave 113 (VERI Treasure). Single summary endpoint backing the /rewards
// page and the home-dashboard AchievementCard -- points balance, recent
// ledger activity, every achievement with this user's progress, and active
// streaks, in one round trip.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const enabled = await isVeriRewardEnabledForOrg(orgId)
    if (!enabled) return NextResponse.json({ enabled: false })

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const [balance, history, achievements, streaks] = await Promise.all([
        getPointsBalance(db, orgId, dbUser.id),
        listPointsHistory(db, orgId, dbUser.id, 20),
        listAchievementsWithProgress(db, orgId, dbUser.id),
        listStreaks(db, orgId, dbUser.id),
      ])
      return { balance, history, achievements, streaks }
    })

    return NextResponse.json({
      enabled: true,
      pointsBalance: result.balance,
      pointsHistory: result.history.map((h) => ({
        delta: h.delta,
        sourceType: h.sourceType,
        reason: h.reason,
        createdAt: h.createdAt.toISOString(),
      })),
      achievements: result.achievements,
      streaks: result.streaks.map((s) => ({
        streakKey: s.streakKey,
        currentCount: s.currentCount,
        longestCount: s.longestCount,
        graceAvailable: s.graceUsedAt === null,
      })),
    })
  } catch (error) {
    console.error("VERI Treasure summary error:", error)
    return NextResponse.json({ error: "Failed to load VERI Treasure summary" }, { status: 500 })
  }
}
