import { NextRequest, NextResponse } from "next/server"
import { requireAuth, hasRole } from "@/lib/supabase/auth-guard"
import { getEnrollment, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const enrollment = await getEnrollment({ orgId }, id)
    if (enrollment.employeeId !== dbUser.id && !hasRole(dbUser, "manager")) {
      return NextResponse.json({ error: "Not authorized to view this enrollment" }, { status: 403 })
    }
    return NextResponse.json(enrollment)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training enrollment detail error:", error)
    return NextResponse.json({ error: "Failed to fetch enrollment" }, { status: 500 })
  }
}
