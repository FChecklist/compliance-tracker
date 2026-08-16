import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { approveBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const boq = await approveBoq({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(boq)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction BOQ approve error:", error)
    return NextResponse.json({ error: "Failed to approve BOQ" }, { status: 500 })
  }
}
