import { NextResponse, NextRequest } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listEmployeeTaxExemptions, createEmployeeTaxExemption, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ exemptions: [] })

  try {
    const { id } = await params
    const financialYear = request.nextUrl.searchParams.get("financialYear") || undefined
    const exemptions = await listEmployeeTaxExemptions({ orgId }, id, financialYear)
    return NextResponse.json({ exemptions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Employee tax exemptions list error:", error)
    return NextResponse.json({ error: "Failed to fetch tax exemptions" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const exemption = await createEmployeeTaxExemption({ orgId, userId: dbUser.id, dbUser }, { ...body, employeeId: id })
    return NextResponse.json(exemption, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Employee tax exemption create error:", error)
    return NextResponse.json({ error: "Failed to create tax exemption" }, { status: 500 })
  }
}
