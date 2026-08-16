import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { approveKpiEntry, ServiceError } from "@/lib/services/construction-kpi-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const entry = await approveKpiEntry({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction KPI entry approve error:", error)
    return NextResponse.json({ error: "Failed to approve KPI entry" }, { status: 500 })
  }
}
