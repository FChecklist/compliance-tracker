import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { postCycleCountAdjustment, ServiceError } from "@/lib/services/erp-inventory-planning-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const line = await postCycleCountAdjustment({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(line)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Cycle count adjustment error:", error)
    return NextResponse.json({ error: "Failed to post adjustment" }, { status: 500 })
  }
}
