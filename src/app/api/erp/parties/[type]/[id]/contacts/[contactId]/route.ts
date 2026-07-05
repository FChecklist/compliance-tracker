import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { deleteContact, ServiceError } from "@/lib/services/erp-party-service"

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { contactId } = await params
    await deleteContact({ orgId }, contactId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contact delete error:", error)
    return NextResponse.json({ error: "Failed to delete contact" }, { status: 500 })
  }
}
