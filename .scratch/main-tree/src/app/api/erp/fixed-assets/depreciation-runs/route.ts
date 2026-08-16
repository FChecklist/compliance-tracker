import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { runDepreciationBatch, ServiceError } from "@/lib/services/erp-fixed-assets-service"

/**
 * Posts every unposted depreciation-schedule row (org-wide, or scoped to
 * one assetId) whose scheduleDate <= asOfDate -- the real monthly
 * depreciation run.
 *
 * VERIDIAN Review Framework remediation (Critical: Access Control /
 * Role-Based Permissions): this route previously carried a comment
 * claiming no elevated gate was needed here, "matching submitJournalEntry's
 * own precedent." That comparison doesn't actually hold: submitJournalEntry
 * requires a real dbUser AND checks isPeriodOpenForDate before posting a
 * SINGLE journal entry a human explicitly created and reviewed line-by-line;
 * this route posts an entire BATCH of GL entries across every unposted
 * schedule row org-wide with a single API call and no per-row review. That
 * is a materially larger blast radius for a mis-run and belongs at
 * "manager" rank (ERP_ACTION_ROLES["erp.fixed_assets.depreciation_run"]),
 * consistent with every other bulk/high-blast-radius financial action in
 * this module (disposal, capitalization). The underlying stale
 * period-open gap this comment also implicitly assumed was already covered
 * is now actually closed in erp-fixed-assets-service.ts's
 * runDepreciationBatch itself (isPeriodOpenForDate per row), not just
 * asserted in a comment.
 */
export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fixed_assets.depreciation_run")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    if (!body.asOfDate) return NextResponse.json({ error: "asOfDate is required" }, { status: 400 })
    const result = await runDepreciationBatch({ orgId, userId: dbUser.id, dbUser }, { asOfDate: body.asOfDate, assetId: body.assetId })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Depreciation run error:", error)
    return NextResponse.json({ error: "Failed to run depreciation" }, { status: 500 })
  }
}
