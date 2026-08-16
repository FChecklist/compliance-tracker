import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPayrollRuns, createPayrollRun, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ runs: [] })

  try {
    const runs = await listPayrollRuns({ orgId })
    return NextResponse.json({ runs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payroll runs list error:", error)
    return NextResponse.json({ error: "Failed to fetch payroll runs" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const run = await createPayrollRun({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(run, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payroll run create error:", error)
    return NextResponse.json({ error: "Failed to create payroll run" }, { status: 500 })
  }
}
