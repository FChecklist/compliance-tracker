import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { runDepreciationBatch, ServiceError } from "@/lib/services/erp-fixed-assets-service"

/**
 * Posts every unposted depreciation-schedule row (org-wide, or scoped to
 * one assetId) whose scheduleDate <= asOfDate -- the real monthly
 * depreciation run. No elevated role gate here, matching
 * submitJournalEntry's own precedent (posting into the GL doesn't require
 * a manager-rank route gate; the org's own approval-workflow configuration,
 * if any, is what governs elevated sign-off elsewhere in this module).
 */
export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

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
