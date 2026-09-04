import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { markCommissionPaid, ServiceError } from "@/lib/services/sales-engine-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  const roleCheck = requireRole(dbUser, "branch_manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const { note } = await request.json().catch(() => ({}))
    const result = await markCommissionPaid({ dbUser }, id, note)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Mark commission paid error:", error)
    return NextResponse.json({ error: "Failed to mark commission as paid" }, { status: 500 })
  }
}
