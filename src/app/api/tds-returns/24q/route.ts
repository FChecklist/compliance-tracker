import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateForm24QReport, ServiceError } from "@/lib/services/tds-return-service"

export async function GET(req: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const financialYearStart = Number(req.nextUrl.searchParams.get("financialYearStart"))
    const quarter = Number(req.nextUrl.searchParams.get("quarter")) as 1 | 2 | 3 | 4
    if (!financialYearStart || ![1, 2, 3, 4].includes(quarter)) return NextResponse.json({ error: "financialYearStart and quarter (1-4) are required" }, { status: 400 })
    const report = await generateForm24QReport({ orgId }, financialYearStart, quarter)
    return NextResponse.json({ report })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Generate Form 24Q error:", error)
    return NextResponse.json({ error: "Failed to generate Form 24Q" }, { status: 500 })
  }
}
