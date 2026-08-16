import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { submitPurchaseOrder, ServiceError } from "@/lib/services/erp-buying-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const po = await submitPurchaseOrder({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(po)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase order submit error:", error)
    return NextResponse.json({ error: "Failed to submit purchase order" }, { status: 500 })
  }
}
