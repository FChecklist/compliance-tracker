// Priority 15 (PROJEXA HR & Payroll, Wave 1): thin ALIASING route -- zero new
// business logic. Calls hr-service.ts's real listEmployees/
// upsertEmployeeProfile directly. This is company-employee HR (project
// managers, architects, office staff) -- NOT the same concept as
// /api/v1/projexa/labour or /attendance, which are site-labour manpower via
// construction-labour-service.ts. No field reshaping needed here (unlike
// vendors/route.ts's supplier->vendor renaming) since "employee" is already
// construction-domain-neutral language.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listEmployees, upsertEmployeeProfile, ServiceError } from "@/lib/services/hr-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ employees: [] })

  try {
    const companyId = request.nextUrl.searchParams.get("companyId") ?? undefined
    const employees = await listEmployees({ orgId: ctx.orgId }, { companyId })
    return NextResponse.json({ employees })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa employees list error:", error)
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 })
  }
}

// Creates/updates the employee PROFILE (job title, employment type, dates)
// for an already-existing user -- hr-service.ts has no "createEmployee",
// since a user row is provisioned via auth/onboarding, not HR. Callers must
// pass userId identifying that existing user.
export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.userId) return NextResponse.json({ error: "userId is required (the employee's existing user account)" }, { status: 400 })
    const profile = await upsertEmployeeProfile({ orgId: ctx.orgId, userId: ctx.dbUser.id }, body.userId, {
      employeeCode: body.employeeCode, jobTitle: body.jobTitle, employmentType: body.employmentType,
      dateOfJoining: body.dateOfJoining, dateOfBirth: body.dateOfBirth,
      employmentStatus: body.employmentStatus, emergencyContactName: body.emergencyContactName, emergencyContactPhone: body.emergencyContactPhone,
      companyId: body.companyId,
    })
    return NextResponse.json(profile, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa employee upsert error:", error)
    return NextResponse.json({ error: "Failed to save employee profile" }, { status: 500 })
  }
}
