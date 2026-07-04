import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPeriods, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ periods: [] })

  try {
    const fiscalYearId = request.nextUrl.searchParams.get("fiscalYearId") || undefined
    const periods = await listPeriods({ orgId }, fiscalYearId)
    return NextResponse.json({ periods })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Periods list error:", error)
    return NextResponse.json({ error: "Failed to fetch periods" }, { status: 500 })
  }
}
