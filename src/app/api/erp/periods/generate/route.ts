import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { generatePeriodsForFiscalYear, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { fiscalYearId } = await request.json()
    if (!fiscalYearId) return NextResponse.json({ error: "fiscalYearId is required" }, { status: 400 })
    const periods = await generatePeriodsForFiscalYear({ orgId }, fiscalYearId)
    return NextResponse.json({ periods }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Period generation error:", error)
    return NextResponse.json({ error: "Failed to generate periods" }, { status: 500 })
  }
}
