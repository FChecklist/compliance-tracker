import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listIncomeTaxSlabs, createIncomeTaxSlab, ServiceError } from "@/lib/services/erp-payroll-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ slabs: [] })

  try {
    const slabs = await listIncomeTaxSlabs({ orgId })
    return NextResponse.json({ slabs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Income tax slabs list error:", error)
    return NextResponse.json({ error: "Failed to fetch income tax slabs" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const slab = await createIncomeTaxSlab({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(slab, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Income tax slab create error:", error)
    return NextResponse.json({ error: "Failed to create income tax slab" }, { status: 500 })
  }
}
