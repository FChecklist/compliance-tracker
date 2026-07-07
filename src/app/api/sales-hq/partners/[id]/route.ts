import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { revokePartnerToken, rotatePartnerToken, suspendSalesPartner, ServiceError } from "@/lib/services/sales-engine-service"

// PATCH { action: 'revoke' | 'rotate' | 'suspend' }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const { id } = await params
    const { action } = await request.json()
    let result
    if (action === "revoke") result = await revokePartnerToken({ dbUser }, id)
    else if (action === "rotate") result = await rotatePartnerToken({ dbUser }, id)
    else if (action === "suspend") result = await suspendSalesPartner({ dbUser }, id)
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales partner update error:", error)
    return NextResponse.json({ error: "Failed to update sales partner" }, { status: 500 })
  }
}
