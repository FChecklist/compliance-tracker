import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { cashFlowStatement, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const today = new Date()
    const defaultFrom = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10)
    const fromDate = request.nextUrl.searchParams.get("fromDate") || defaultFrom
    const toDate = request.nextUrl.searchParams.get("toDate") || today.toISOString().slice(0, 10)
    const companyId = request.nextUrl.searchParams.get("companyId") || undefined
    const consolidate = request.nextUrl.searchParams.get("consolidate") === "true"
    const report = await cashFlowStatement({ orgId }, fromDate, toDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cash flow statement error:", error)
    return NextResponse.json({ error: "Failed to generate cash flow statement" }, { status: 500 })
  }
}
