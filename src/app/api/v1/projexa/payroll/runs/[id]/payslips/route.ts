// Priority 15 (PROJEXA HR & Payroll, Wave 1): list payslips for a run.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listPayslips, ServiceError } from "@/lib/services/erp-payroll-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ payslips: [] })

  try {
    const { id } = await params
    const payslips = await listPayslips({ orgId: ctx.orgId }, id)
    return NextResponse.json({ payslips })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payslips list error:", error)
    return NextResponse.json({ error: "Failed to fetch payslips" }, { status: 500 })
  }
}
