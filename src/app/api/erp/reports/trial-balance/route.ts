import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { trialBalance, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") || new Date().toISOString().slice(0, 10)
    const companyId = request.nextUrl.searchParams.get("companyId") || undefined
    const consolidate = request.nextUrl.searchParams.get("consolidate") === "true"
    const report = await trialBalance({ orgId }, asOfDate, { companyId, consolidate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Trial balance error:", error)
    return NextResponse.json({ error: "Failed to generate trial balance" }, { status: 500 })
  }
}
