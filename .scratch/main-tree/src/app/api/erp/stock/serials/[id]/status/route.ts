import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateSerialStatus, ServiceError } from "@/lib/services/erp-uom-batch-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const { status } = await request.json()
    if (!["in_stock", "delivered", "returned"].includes(status)) {
      return NextResponse.json({ error: "status must be 'in_stock', 'delivered', or 'returned'" }, { status: 400 })
    }
    const serial = await updateSerialStatus({ orgId, userId: dbUser.id, dbUser }, id, status)
    return NextResponse.json(serial)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Serial status update error:", error)
    return NextResponse.json({ error: "Failed to update serial status" }, { status: 500 })
  }
}
