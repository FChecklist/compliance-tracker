// CO-003 "Cost Center Hierarchy Report". Thin route over erp-accounting-
// service.ts's costCenterHierarchyReport -- see that function's own header
// comment for the design rationale.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { costCenterHierarchyReport, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const sp = request.nextUrl.searchParams
    const now = new Date()
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const fromDate = sp.get("fromDate") || defaultFrom
    const toDate = sp.get("toDate") || now.toISOString().slice(0, 10)
    const report = await costCenterHierarchyReport({ orgId }, fromDate, toDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cost center hierarchy report error:", error)
    return NextResponse.json({ error: "Failed to generate cost center hierarchy report" }, { status: 500 })
  }
}
