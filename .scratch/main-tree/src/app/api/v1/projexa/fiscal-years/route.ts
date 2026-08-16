// Priority 13 (ERP discovery lookups): thin alias over
// erp-accounting-service.ts's listFiscalYears(). PROJEXA_GAP_ANALYSIS.md
// flagged Budgets/Materials pages as having no way to look up a valid
// fiscalYearId before creating a budget via /api/v1/projexa/project-budgets
// -- this is the read-side lookup that closes that gap. Zero new business
// logic, matching every other route in this namespace (Wave 124).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listFiscalYears, ServiceError } from "@/lib/services/erp-accounting-service"

function toFiscalYearShape(fy: Awaited<ReturnType<typeof listFiscalYears>>[number]) {
  return { id: fy.id, yearName: fy.yearName, startDate: fy.startDate, endDate: fy.endDate, isClosed: fy.isClosed }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ fiscalYears: [] })

  try {
    const fiscalYears = await listFiscalYears({ orgId: ctx.orgId })
    return NextResponse.json({ fiscalYears: fiscalYears.map(toFiscalYearShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa fiscal-years list error:", error)
    return NextResponse.json({ error: "Failed to fetch fiscal years" }, { status: 500 })
  }
}
