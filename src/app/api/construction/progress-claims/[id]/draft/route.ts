import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { draftClaim, ServiceError } from "@/lib/services/construction-billing-workflow-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const claim = await draftClaim({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(claim)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Progress claim draft error:", error)
    return NextResponse.json({ error: "Failed to draft progress claim" }, { status: 500 })
  }
}
