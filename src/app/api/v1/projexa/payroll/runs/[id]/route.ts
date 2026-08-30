// Real-screen conversion (2026-08-30): single-run GET for the Payroll Run
// Object Page.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getPayrollRun, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const run = await getPayrollRun({ orgId: ctx.orgId }, id)
    return NextResponse.json(run)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payroll run get error:", error)
    return NextResponse.json({ error: "Failed to fetch payroll run" }, { status: 500 })
  }
}
