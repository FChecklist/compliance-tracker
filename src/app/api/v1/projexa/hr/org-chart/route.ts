// Priority 15 (PROJEXA HR & Payroll, full-depth pass): reporting-hierarchy
// view -- zero new schema, reuses hr-service.ts's getOrgChart() which is
// itself a read-only tree over the pre-existing users.reportingToId/
// departmentId columns.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getOrgChart, ServiceError } from "@/lib/services/hr-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ employees: [], roots: [], byManager: {} })

  try {
    const chart = await getOrgChart({ orgId: ctx.orgId })
    return NextResponse.json(chart)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa org chart error:", error)
    return NextResponse.json({ error: "Failed to fetch org chart" }, { status: 500 })
  }
}
