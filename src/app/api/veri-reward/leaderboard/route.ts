import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { getOrgLeaderboard } from "@/lib/services/veri-reward-service"
import { requireVeriRewardEnabled, ServiceError } from "@/lib/services/veri-reward-enablement-service"

const MAX_LIMIT = 100

// Wave 113 (VERI Treasure). Org-wide points ranking -- the HR/team
// leaderboard surface. No admin gate: seeing where you rank against
// teammates is the entire point of a leaderboard, and this never exposes
// anything beyond name/avatar/points balance.
//
// task-20260718-083002 (Review Framework "Search, Filter & Bulk Operations"
// gap): ?limit=&offset= let a caller page past the previous hardcoded
// top-10 -- defaults unchanged so every existing caller keeps working
// as-is.
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit")) || 10))
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0)

  try {
    await requireVeriRewardEnabled(orgId)
    const leaderboard = await withTenantContext({ orgId, userId: dbUser.id }, (db) => getOrgLeaderboard(db, orgId, limit, offset))
    return NextResponse.json({ leaderboard })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure leaderboard error:", error)
    return NextResponse.json({ error: "Failed to load leaderboard" }, { status: 500 })
  }
}
