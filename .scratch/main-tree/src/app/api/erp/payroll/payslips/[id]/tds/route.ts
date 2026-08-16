import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updatePayslipTds, ServiceError } from "@/lib/services/erp-payroll-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const { tdsAmount } = await request.json()
    const payslip = await updatePayslipTds({ orgId, userId: dbUser.id, dbUser }, id, Number(tdsAmount))
    return NextResponse.json(payslip)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payslip TDS update error:", error)
    return NextResponse.json({ error: "Failed to update TDS" }, { status: 500 })
  }
}
