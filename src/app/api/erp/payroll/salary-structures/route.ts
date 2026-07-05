import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSalaryStructures, createSalaryStructure, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ structures: [] })

  try {
    const structures = await listSalaryStructures({ orgId })
    return NextResponse.json({ structures })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Salary structures list error:", error)
    return NextResponse.json({ error: "Failed to fetch salary structures" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const structure = await createSalaryStructure({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(structure, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Salary structure create error:", error)
    return NextResponse.json({ error: "Failed to create salary structure" }, { status: 500 })
  }
}
