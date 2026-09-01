import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { listPointsHistory } from "@/lib/services/veri-reward-service"
import { requireVeriRewardEnabled, ServiceError } from "@/lib/services/veri-reward-enablement-service"
import { rowsToCSV } from "@/lib/report-export-shared"

const EXPORT_ROW_CAP = 5000

// task-20260718-083002 (Review Framework "Data Import/Export Template
// Fidelity" gap, High): VERI Reward had no import/export of any kind --
// this is the CSV export of the caller's own points-history ledger (the
// recommended-approach text's own scope: "a simple CSV export of points
// history"). Uses the same server-side rowsToCSV() buffered-response
// pattern as src/app/api/v1/reports/definitions/[id]/run/route.ts, not a
// bespoke one. Optional ?startDate=&endDate= narrow the export to the same
// date range the /rewards page's own history filter is showing.
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const startDateParam = searchParams.get("startDate")
  const endDateParam = searchParams.get("endDate")
  const startDate = startDateParam ? new Date(startDateParam) : undefined
  const endDate = endDateParam ? new Date(endDateParam) : undefined
  if ((startDateParam && Number.isNaN(startDate?.getTime())) || (endDateParam && Number.isNaN(endDate?.getTime()))) {
    return NextResponse.json({ error: "startDate/endDate must be valid ISO date strings" }, { status: 400 })
  }

  try {
    await requireVeriRewardEnabled(orgId)
    const history = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      listPointsHistory(db, orgId, dbUser.id, { limit: EXPORT_ROW_CAP, startDate, endDate })
    )

    if (history.length === 0) {
      return NextResponse.json({ error: "No points history to export" }, { status: 404 })
    }

    const csv = rowsToCSV(
      history.map((h) => ({
        date: h.createdAt.toISOString(),
        delta: h.delta,
        sourceType: h.sourceType,
        reason: h.reason ?? "",
      }))
    )

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="veri-reward-points-history-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure export error:", error)
    return NextResponse.json({ error: "Failed to export points history" }, { status: 500 })
  }
}
