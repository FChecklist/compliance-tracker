// FI-AA-006 (SAP-equivalent gap analysis, "Asset-to-GL Reconciliation",
// BUILD_NEW/MEDIUM): thin route over erp-fixed-assets-service.ts's
// assetToGlReconciliation -- per asset-category comparison of the fixed-
// asset sub-ledger's aggregate gross cost / accumulated depreciation / net
// book value against the real posted balance of that category's own
// mapped GL accounts. See that function's own header comment for the full
// discovery notes (a real GL-posting bug -- fixed in this same PR -- meant
// every fixed-asset journal entry ever created sat permanently in draft,
// invisible to any GL balance query) and its documented scope limits
// (a category with no GL accounts configured is reported as 'not_mapped'
// rather than silently skipped; asOfDate in the past is flagged via
// isStaleComparison since the sub-ledger side has no dated history). No
// dedicated UI page yet -- API-only, same honest "no dashboard surface"
// caveat this wave's sibling reports (FI-AR-004/FI-AP-005/FI-AP-007/
// FI-AP-008) already disclose.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { assetToGlReconciliation, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2 investigation, 2026-08-27):
  // this read had no floor at all -- rank-1 roles (viewer/client_viewer/
  // external_auditor/stage_0, see ROLE_RANK in auth-guard.ts) could read
  // real GL money figures (per-category subledger gross cost/accumulated
  // depreciation/net book value AND the mapped GL account's actual posted
  // balance/variance). Matches the exact requireRoleOrScope(ctx, "member",
  // "read") pattern already used identically by 13 sibling
  // /api/v1/projexa/** GET routes -- including dashboard/route.ts, which
  // was fixed at this same floor for equally-sensitive aggregate financial
  // figures (revenue/budget/expenses) in this same investigation wave. No
  // route in this codebase gates a GET/read above "member" (no finance-
  // specific tier exists in ROLE_RANK), so "member" is the floor that's
  // both sufficient (excludes only the viewer-tier ranks) and consistent.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const report = await assetToGlReconciliation({ orgId: ctx.orgId }, { asOfDate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa asset-to-gl-reconciliation error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
