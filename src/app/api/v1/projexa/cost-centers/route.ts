// Priority 13 (ERP discovery lookups): thin alias over
// erp-accounting-service.ts's listCostCenters(). Same rationale as the
// sibling fiscal-years/route.ts -- PROJEXA's Budgets page needs a
// costCenterId to create a budget and had no discovery API for it.
// erp_cost_centers.projectId links a cost center to a specific project (see
// schema.ts) so callers that only want the ones scoped to their project can
// filter client-side on that field; the service itself stays org-scoped
// only, matching listFiscalYears/listSuppliers etc.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listCostCenters, ServiceError } from "@/lib/services/erp-accounting-service"

function toCostCenterShape(cc: Awaited<ReturnType<typeof listCostCenters>>[number]) {
  return { id: cc.id, name: cc.name, parentCostCenterId: cc.parentCostCenterId, isGroup: cc.isGroup, departmentId: cc.departmentId, projectId: cc.projectId }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27): this read had no
  // floor at all -- rank-1 roles (viewer/client_viewer/external_auditor/
  // stage_0, see ROLE_RANK in auth-guard.ts) could call this route with zero
  // role check. "member" is the right floor, not a higher one: the response
  // shape (toCostCenterShape below) is pure structural/reference data -- id,
  // name, parentCostCenterId, isGroup, departmentId, projectId -- no money
  // figures, no commercial terms, no named individual's PII. Matches the
  // exact requireRoleOrScope(ctx, "member", "read") pattern already used
  // identically by 10+ sibling /api/v1/projexa/** GET routes (see
  // employees/route.ts, vendors/route.ts, dashboard/route.ts -- #1399).
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ costCenters: [] })

  try {
    const costCenters = await listCostCenters({ orgId: ctx.orgId })
    return NextResponse.json({ costCenters: costCenters.map(toCostCenterShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa cost-centers list error:", error)
    return NextResponse.json({ error: "Failed to fetch cost centers" }, { status: 500 })
  }
}
