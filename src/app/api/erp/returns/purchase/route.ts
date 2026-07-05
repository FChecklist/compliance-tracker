import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPurchaseReturns, createPurchaseReturn, ServiceError } from "@/lib/services/erp-returns-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ returns: [] })

  try {
    const returns = await listPurchaseReturns({ orgId })
    return NextResponse.json({ returns })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase returns list error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase returns" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const created = await createPurchaseReturn({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase return create error:", error)
    return NextResponse.json({ error: "Failed to create purchase return" }, { status: 500 })
  }
}
