import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPayslips, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ payslips: [] })

  try {
    const { id } = await params
    const payslips = await listPayslips({ orgId }, id)
    return NextResponse.json({ payslips })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payslips list error:", error)
    return NextResponse.json({ error: "Failed to fetch payslips" }, { status: 500 })
  }
}
