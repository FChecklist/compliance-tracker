import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { reviewDuplicateCandidate, ServiceError } from "@/lib/services/mdm-quality-service"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (body.status !== "confirmed_duplicate" && body.status !== "not_duplicate") {
      return NextResponse.json({ error: "status must be 'confirmed_duplicate' or 'not_duplicate'" }, { status: 400 })
    }
    const candidate = await reviewDuplicateCandidate({ orgId, userId: dbUser.id, dbUser }, id, body.status)
    return NextResponse.json(candidate)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("MDM duplicate review error:", error)
    return NextResponse.json({ error: "Failed to review duplicate candidate" }, { status: 500 })
  }
}
