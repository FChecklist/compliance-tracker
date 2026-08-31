// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-financial-report-service.ts's balanceSheet -- asset/liability/equity
// accounts as of a date, pure aggregation, no new business logic.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { balanceSheet, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27): this read had no
  // floor at all -- rank-1 roles (viewer/client_viewer/external_auditor/
  // stage_0, see ROLE_RANK in auth-guard.ts) could read the org's full
  // balance sheet: every GL account's real netBalance plus totalAssets/
  // totalLiabilities/totalEquity (see erp-financial-report-service.ts's
  // balanceSheet()) -- the org's entire financial position, not lookup/
  // reference data. Floor set to "member", matching the exact
  // requireRoleOrScope(ctx, "member", "read") pattern already used
  // identically by every other live GET read-gate in this codebase
  // (employees, vendors, dashboard -- the latter exposing comparably
  // sensitive revenue/expenses/budget figures) -- there is no established
  // higher-than-member read floor anywhere in this codebase to diverge to.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const sp = request.nextUrl.searchParams
    const asOfDate = sp.get("asOfDate") || new Date().toISOString().slice(0, 10)
    const companyId = sp.get("companyId") || undefined
    const consolidate = sp.get("consolidate") === "true"
    const report = await balanceSheet({ orgId: ctx.orgId }, asOfDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa balance-sheet error:", error)
    return NextResponse.json({ error: "Failed to generate balance sheet" }, { status: 500 })
  }
}
