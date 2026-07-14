// Priority 15 (PROJEXA HR & Payroll, full-depth pass): per-employee CTC
// breakdown (which components + amounts/percentages make up an employee's
// pay) -- what processPayrollRun reads to generate each month's payslip.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSalaryStructures, createSalaryStructure, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ structures: [] })

  try {
    const structures = await listSalaryStructures({ orgId: ctx.orgId })
    return NextResponse.json({ structures })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa salary structures list error:", error)
    return NextResponse.json({ error: "Failed to fetch salary structures" }, { status: 500 })
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
    const structure = await createSalaryStructure({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(structure, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa salary structure create error:", error)
    return NextResponse.json({ error: "Failed to create salary structure" }, { status: 500 })
  }
}
