import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSalaryComponents, createSalaryComponent, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ components: [] })

  try {
    const components = await listSalaryComponents({ orgId })
    return NextResponse.json({ components })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Salary components list error:", error)
    return NextResponse.json({ error: "Failed to fetch salary components" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const component = await createSalaryComponent({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(component, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Salary component create error:", error)
    return NextResponse.json({ error: "Failed to create salary component" }, { status: 500 })
  }
}
