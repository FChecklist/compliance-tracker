import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPurchaseRequisitions, createPurchaseRequisition, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ requisitions: [] })

  try {
    const requisitions = await listPurchaseRequisitions({ orgId })
    return NextResponse.json({ requisitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase requisitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase requisitions" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const req_ = await createPurchaseRequisition({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(req_, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase requisition create error:", error)
    return NextResponse.json({ error: "Failed to create purchase requisition" }, { status: 500 })
  }
}
