// Priority 15 (PROJEXA HR & Payroll, Wave 1): processes a draft payroll run
// into payslips via erp-payroll-service.ts's real computation engine.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { processPayrollRun, ServiceError } from "@/lib/services/erp-payroll-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const result = await processPayrollRun({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payroll run process error:", error)
    return NextResponse.json({ error: "Failed to process payroll run" }, { status: 500 })
  }
}
