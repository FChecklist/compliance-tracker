// Priority 15 (PROJEXA HR & Payroll, Wave 1): thin ALIASING route over
// erp-payroll-service.ts's real payroll-run engine (PF/ESI/PT/TDS computed
// by an admin-editable rule engine, never hardcoded -- see that file's own
// header). createPayrollRun requires a real dbUser (used for logActivity's
// audit trail), same "requires a real user session, not an API key" posture
// already established at /api/v1/erp/inventory/receipts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listPayrollRuns, createPayrollRun, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ runs: [] })

  try {
    const runs = await listPayrollRuns({ orgId: ctx.orgId })
    return NextResponse.json({ runs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payroll runs list error:", error)
    return NextResponse.json({ error: "Failed to fetch payroll runs" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const run = await createPayrollRun({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(run, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa payroll run create error:", error)
    return NextResponse.json({ error: "Failed to create payroll run" }, { status: 500 })
  }
}
