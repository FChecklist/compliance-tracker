// Priority 15 (PROJEXA HR & Payroll, Wave 1): single-employee detail + update.
// hr-service.ts has no getEmployee(id) -- reuses listEmployees and filters,
// same cost as the real query since it's one org's worth of rows and this is
// not a hot path. PATCH reuses the same upsertEmployeeProfile as the list
// route's POST -- both are "create-if-absent, update-if-present" by design.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listEmployees, upsertEmployeeProfile, ServiceError } from "@/lib/services/hr-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const employees = await listEmployees({ orgId: ctx.orgId })
    const employee = employees.find((e) => e.id === id)
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 })
    return NextResponse.json(employee)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa employee detail error:", error)
    return NextResponse.json({ error: "Failed to fetch employee" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const profile = await upsertEmployeeProfile({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id, {
      employeeCode: body.employeeCode, jobTitle: body.jobTitle, employmentType: body.employmentType,
      dateOfJoining: body.dateOfJoining, dateOfBirth: body.dateOfBirth,
    })
    return NextResponse.json(profile)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa employee update error:", error)
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 })
  }
}
