import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { recordStreakCheckIn } from "@/lib/services/veri-reward-service"
import { requireVeriRewardEnabled, ServiceError } from "@/lib/services/veri-reward-enablement-service"

// Wave 113 (VERI Treasure). One check-in per streakKey per calendar day --
// recordStreakCheckIn() itself is idempotent for same-day repeats, so this
// route can be called freely (e.g. on every dashboard load) without
// over-incrementing.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const { streakKey } = body as { streakKey?: string }
    if (!streakKey || typeof streakKey !== "string" || !streakKey.trim()) {
      return NextResponse.json({ error: "streakKey is required" }, { status: 400 })
    }

    await requireVeriRewardEnabled(orgId)

    const result = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      recordStreakCheckIn(db, orgId, dbUser.id, streakKey.trim())
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure streak check-in error:", error)
    return NextResponse.json({ error: "Failed to record streak check-in" }, { status: 500 })
  }
}
