import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { deleteCorrespondent, ServiceError } from "@/lib/services/document-classification-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    await deleteCorrespondent({ orgId }, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Correspondent delete error:", error)
    return NextResponse.json({ error: "Failed to delete correspondent" }, { status: 500 })
  }
}
