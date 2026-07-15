// Priority 15 (PROJEXA HR & Payroll, full-depth pass): declared tax-saving
// exemptions per employee per financial year, fed into computeAnnualTds.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listEmployeeTaxExemptions, createEmployeeTaxExemption, ServiceError } from "@/lib/services/erp-payroll-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ exemptions: [] })

  try {
    const { id } = await params
    const financialYear = request.nextUrl.searchParams.get("financialYear") || undefined
    const exemptions = await listEmployeeTaxExemptions({ orgId: ctx.orgId }, id, financialYear)
    return NextResponse.json({ exemptions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa employee tax exemptions list error:", error)
    return NextResponse.json({ error: "Failed to fetch tax exemptions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const exemption = await createEmployeeTaxExemption({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, { ...body, employeeId: id })
    return NextResponse.json(exemption, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa employee tax exemption create error:", error)
    return NextResponse.json({ error: "Failed to create tax exemption" }, { status: 500 })
  }
}
