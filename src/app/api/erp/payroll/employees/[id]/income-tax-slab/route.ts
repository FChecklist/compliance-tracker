import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { assignIncomeTaxSlab, ServiceError } from "@/lib/services/erp-payroll-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const updated = await assignIncomeTaxSlab({ orgId, userId: dbUser.id, dbUser }, id, body.slabId || undefined)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Assign income tax slab error:", error)
    return NextResponse.json({ error: "Failed to assign income tax slab" }, { status: 500 })
  }
}
