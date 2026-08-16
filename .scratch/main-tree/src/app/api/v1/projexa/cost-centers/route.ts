// Priority 13 (ERP discovery lookups): thin alias over
// erp-accounting-service.ts's listCostCenters(). Same rationale as the
// sibling fiscal-years/route.ts -- PROJEXA's Budgets page needs a
// costCenterId to create a budget and had no discovery API for it.
// erp_cost_centers.projectId links a cost center to a specific project (see
// schema.ts) so callers that only want the ones scoped to their project can
// filter client-side on that field; the service itself stays org-scoped
// only, matching listFiscalYears/listSuppliers etc.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listCostCenters, ServiceError } from "@/lib/services/erp-accounting-service"

function toCostCenterShape(cc: Awaited<ReturnType<typeof listCostCenters>>[number]) {
  return { id: cc.id, name: cc.name, parentCostCenterId: cc.parentCostCenterId, isGroup: cc.isGroup, departmentId: cc.departmentId, projectId: cc.projectId }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
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
