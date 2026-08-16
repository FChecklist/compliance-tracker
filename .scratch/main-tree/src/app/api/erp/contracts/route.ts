import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listContracts, createContract, ServiceError } from "@/lib/services/erp-contract-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ contracts: [] })

  try {
    const contracts = await listContracts({ orgId })
    return NextResponse.json({ contracts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contracts list error:", error)
    return NextResponse.json({ error: "Failed to fetch contracts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const contract = await createContract({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(contract, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contract create error:", error)
    return NextResponse.json({ error: "Failed to create contract" }, { status: 500 })
  }
}
