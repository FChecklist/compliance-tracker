import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getMonthlySummaries, ServiceError } from "@/lib/services/hr-attendance-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ summaries: [] })

  try {
    const params = request.nextUrl.searchParams
    const now = new Date()
    const month = Number(params.get("month")) || now.getUTCMonth() + 1
    const year = Number(params.get("year")) || now.getUTCFullYear()
    const summaries = await getMonthlySummaries({ orgId }, {
      month, year,
      userId: params.get("userId") || undefined,
      departmentId: params.get("departmentId") || undefined,
      companyId: params.get("companyId") || undefined,
    })
    return NextResponse.json({ summaries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Attendance summary error:", error)
    return NextResponse.json({ error: "Failed to compute attendance summary" }, { status: 500 })
  }
}
