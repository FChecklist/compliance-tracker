import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { setRetentionPolicy, setLegalHold, ServiceError } from "@/lib/services/document-service"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (typeof body.legalHold === "boolean") {
      const doc = await setLegalHold({ orgId }, id, body.legalHold)
      return NextResponse.json(doc)
    }
    if (!body.retentionPeriodDays) return NextResponse.json({ error: "retentionPeriodDays is required" }, { status: 400 })
    const doc = await setRetentionPolicy({ orgId }, id, Number(body.retentionPeriodDays))
    return NextResponse.json(doc)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Document retention update error:", error)
    return NextResponse.json({ error: "Failed to update retention policy" }, { status: 500 })
  }
}
