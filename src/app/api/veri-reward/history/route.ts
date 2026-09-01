import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { listPointsHistory, countPointsHistory } from "@/lib/services/veri-reward-service"
import { requireVeriRewardEnabled, ServiceError } from "@/lib/services/veri-reward-enablement-service"

const MAX_LIMIT = 100

// task-20260718-083002 (Review Framework "Search, Filter & Bulk Operations"
// gap): the summary endpoint's own points-history slice is a fixed most-
// recent-20 with no way to page further back or filter by date -- this is
// the dedicated paginated/filterable endpoint for the "Recent activity"
// list's own "load more" / date-range controls, kept separate from the
// summary endpoint so a normal page load stays a single cheap query.
// ?limit=&offset=&startDate=&endDate= (startDate/endDate are ISO date
// strings, inclusive on createdAt).
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit")) || 20))
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0)

  const startDateParam = searchParams.get("startDate")
  const endDateParam = searchParams.get("endDate")
  const startDate = startDateParam ? new Date(startDateParam) : undefined
  const endDate = endDateParam ? new Date(endDateParam) : undefined
  if ((startDateParam && Number.isNaN(startDate?.getTime())) || (endDateParam && Number.isNaN(endDate?.getTime()))) {
    return NextResponse.json({ error: "startDate/endDate must be valid ISO date strings" }, { status: 400 })
  }

  try {
    await requireVeriRewardEnabled(orgId)
    const filter = { limit, offset, startDate, endDate }
    const { history, total } = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const [history, total] = await Promise.all([
        listPointsHistory(db, orgId, dbUser.id, filter),
        countPointsHistory(db, orgId, dbUser.id, { startDate, endDate }),
      ])
      return { history, total }
    })

    return NextResponse.json({
      history: history.map((h) => ({
        delta: h.delta,
        sourceType: h.sourceType,
        reason: h.reason,
        createdAt: h.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure history error:", error)
    return NextResponse.json({ error: "Failed to load points history" }, { status: 500 })
  }
}
