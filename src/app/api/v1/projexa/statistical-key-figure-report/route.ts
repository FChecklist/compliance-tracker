// CO-006 (SAP-equivalent gap analysis, "Statistical Key Figure Report",
// BUILD_NEW/LOW): thin route over erp-costing-service.ts's
// statisticalKeyFigureReport -- per-cost-center plan/actual values (with
// variance) for the requested statistical key figure type(s), summed
// across postings in the requested accounting period(s). Direct template:
// src/app/api/v1/projexa/asset-to-gl-reconciliation/route.ts. No dedicated
// UI page yet -- API-only, same honest "no dashboard surface" caveat this
// wave's sibling reports already disclose.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { statisticalKeyFigureReport, ServiceError } from "@/lib/services/erp-costing-service"

function parseListParam(value: string | null): string[] | undefined {
  if (!value) return undefined
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const accountingPeriodIds = parseListParam(request.nextUrl.searchParams.get("accountingPeriodIds"))
    if (!accountingPeriodIds) {
      return NextResponse.json({ error: "accountingPeriodIds is required (comma-separated list of at least one erp_accounting_periods id)" }, { status: 400 })
    }
    const costCenterIds = parseListParam(request.nextUrl.searchParams.get("costCenterIds"))
    const statKeyFigureTypeIds = parseListParam(request.nextUrl.searchParams.get("statKeyFigureTypeIds"))

    const report = await statisticalKeyFigureReport({ orgId: ctx.orgId }, { accountingPeriodIds, costCenterIds, statKeyFigureTypeIds })
    return NextResponse.json({ rows: report })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa statistical-key-figure-report error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
