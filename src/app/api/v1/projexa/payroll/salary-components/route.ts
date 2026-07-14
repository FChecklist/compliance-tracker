// Priority 15 (PROJEXA HR & Payroll, full-depth pass): salary component
// master data (Basic, HRA, Special Allowance, statutory deductions, ...) --
// the building blocks salary structures are assembled from.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSalaryComponents, createSalaryComponent, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ components: [] })

  try {
    const components = await listSalaryComponents({ orgId: ctx.orgId })
    return NextResponse.json({ components })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa salary components list error:", error)
    return NextResponse.json({ error: "Failed to fetch salary components" }, { status: 500 })
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
    const component = await createSalaryComponent({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(component, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa salary component create error:", error)
    return NextResponse.json({ error: "Failed to create salary component" }, { status: 500 })
  }
}
