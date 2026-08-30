// Real-screen conversion (2026-08-30): single-payslip GET for the Payslip
// Object Page -- getPayslipDetail() already existed (built for the PDF
// route) but had no plain GET route of its own.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getPayslipDetail, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const detail = await getPayslipDetail({ orgId: ctx.orgId }, id)
    return NextResponse.json(detail)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payslip get error:", error)
    return NextResponse.json({ error: "Failed to fetch payslip" }, { status: 500 })
  }
}
