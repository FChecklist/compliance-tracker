import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { markPutawayComplete, ServiceError } from "@/lib/services/erp-goods-receipt-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: routine warehouse physical operation
  const roleErr = requirePermissionForUser(dbUser, "erp.goods_receipts.putaway")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const receipt = await markPutawayComplete({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(receipt)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Putaway complete error:", error)
    return NextResponse.json({ error: "Failed to complete putaway" }, { status: 500 })
  }
}
