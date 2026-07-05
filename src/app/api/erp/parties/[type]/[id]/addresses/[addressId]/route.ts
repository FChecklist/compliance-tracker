import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { deleteAddress, ServiceError } from "@/lib/services/erp-party-service"

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ addressId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { addressId } = await params
    await deleteAddress({ orgId }, addressId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Address delete error:", error)
    return NextResponse.json({ error: "Failed to delete address" }, { status: 500 })
  }
}
