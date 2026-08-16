import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { reviewCertification, ServiceError } from "@/lib/services/access-review-service"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; certId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const { certId } = await params
    const body = await request.json()
    if (body.decision !== "confirmed" && body.decision !== "revoked") {
      return NextResponse.json({ error: "decision must be 'confirmed' or 'revoked'" }, { status: 400 })
    }
    const certification = await reviewCertification({ orgId, userId: dbUser.id, dbUser }, certId, body.decision)
    return NextResponse.json(certification)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Access review certification decision error:", error)
    return NextResponse.json({ error: "Failed to record certification decision" }, { status: 500 })
  }
}
