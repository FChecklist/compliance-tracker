import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listFiscalYears, createFiscalYear, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ fiscalYears: [] })

  try {
    const fiscalYears = await listFiscalYears({ orgId })
    return NextResponse.json({ fiscalYears })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fiscal years list error:", error)
    return NextResponse.json({ error: "Failed to fetch fiscal years" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const fiscalYear = await createFiscalYear({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(fiscalYear, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fiscal year create error:", error)
    return NextResponse.json({ error: "Failed to create fiscal year" }, { status: 500 })
  }
}
