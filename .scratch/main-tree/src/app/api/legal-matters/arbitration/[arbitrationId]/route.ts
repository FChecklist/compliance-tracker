import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateArbitrationStatus, ServiceError } from "@/lib/services/legal-matter-service"

export async function PATCH(request: Request, { params }: { params: Promise<{ arbitrationId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { arbitrationId } = await params
    const body = await request.json()
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 })
    const arbitration = await updateArbitrationStatus({ orgId }, arbitrationId, body.status, body.awardDate)
    return NextResponse.json(arbitration)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Arbitration case status update error:", error)
    return NextResponse.json({ error: "Failed to update arbitration case" }, { status: 500 })
  }
}
