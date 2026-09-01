import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { getEngagementReport } from "@/lib/services/veri-reward-service"
import { requireVeriRewardEnabled, ServiceError } from "@/lib/services/veri-reward-enablement-service"

// task-20260718-083002 (Review Framework "Reporting & Export Accuracy"
// gap, Medium): listPointsHistory()/getOrgLeaderboard() only ever powered
// per-user UI cards -- there was no admin-level rollup report for VERI
// Reward engagement. admin/manager-gated, same bar (and same inline role
// check) as GET /api/settings/adoption-metrics -- comparative org-wide
// engagement data, not something every member should see by default.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can view the VERI Reward engagement report" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    await requireVeriRewardEnabled(orgId)
    const report = await withTenantContext({ orgId, userId: dbUser.id }, (db) => getEngagementReport(db, orgId))
    return NextResponse.json({ report })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure admin report error:", error)
    return NextResponse.json({ error: "Failed to load engagement report" }, { status: 500 })
  }
}
