import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { addBusinessImpactAnalysis, ServiceError } from "@/lib/services/bcm-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const bia = await addBusinessImpactAnalysis({ orgId }, id, body)
    return NextResponse.json(bia, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("BCM BIA create error:", error)
    return NextResponse.json({ error: "Failed to add business impact analysis" }, { status: 500 })
  }
}
