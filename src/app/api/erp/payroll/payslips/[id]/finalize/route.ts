import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { finalizePayslip, ServiceError } from "@/lib/services/erp-payroll-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const payslip = await finalizePayslip({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(payslip)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payslip finalize error:", error)
    return NextResponse.json({ error: "Failed to finalize payslip" }, { status: 500 })
  }
}
