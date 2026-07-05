import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { closeReverseAuction, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const auction = await closeReverseAuction({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(auction)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Reverse auction close error:", error)
    return NextResponse.json({ error: "Failed to close auction" }, { status: 500 })
  }
}
