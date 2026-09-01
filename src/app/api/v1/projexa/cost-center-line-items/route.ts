// CO-001 (SAP KSB1 equivalent, "Cost Center Line Item Display", EXTEND_EXISTING,
// sap_mapping.sqlite/sap_reports, engine_track=calculation): thin route over
// erp-accounting-service.ts's listJournalEntryLinesByCostCenter -- see that
// function's own header comment for the real design. No dedicated UI page
// yet -- API-only, same honest "no dashboard surface" caveat this wave's
// sibling reports already disclose.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listJournalEntryLinesByCostCenter, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const costCenterIds = request.nextUrl.searchParams.getAll("costCenterId")
    const fromDate = request.nextUrl.searchParams.get("fromDate") ?? undefined
    const toDate = request.nextUrl.searchParams.get("toDate") ?? undefined
    const page = request.nextUrl.searchParams.get("page")
    const limit = request.nextUrl.searchParams.get("limit")
    const report = await listJournalEntryLinesByCostCenter(
      { orgId: ctx.orgId },
      {
        costCenterIds: costCenterIds.length ? costCenterIds : undefined,
        fromDate,
        toDate,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }
    )
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa cost-center-line-items error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
