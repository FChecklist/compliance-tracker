import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { getOrgLeaderboard } from "@/lib/services/veri-reward-service"
import { requireVeriRewardEnabled, ServiceError } from "@/lib/services/veri-reward-enablement-service"

// Wave 113 (VERI Treasure). Org-wide points ranking -- the HR/team
// leaderboard surface. No admin gate: seeing where you rank against
// teammates is the entire point of a leaderboard, and this never exposes
// anything beyond name/avatar/points balance.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    await requireVeriRewardEnabled(orgId)
    const leaderboard = await withTenantContext({ orgId, userId: dbUser.id }, (db) => getOrgLeaderboard(db, orgId, 10))
    return NextResponse.json({ leaderboard })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure leaderboard error:", error)
    return NextResponse.json({ error: "Failed to load leaderboard" }, { status: 500 })
  }
}
