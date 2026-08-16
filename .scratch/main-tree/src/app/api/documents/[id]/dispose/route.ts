import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { disposeDocument, ServiceError } from "@/lib/services/document-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const doc = await disposeDocument({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(doc)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document disposal error:", error)
    return NextResponse.json({ error: "Failed to dispose document" }, { status: 500 })
  }
}
