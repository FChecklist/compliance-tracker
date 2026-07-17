import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { assignPath, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// Assign a curriculum to individuals, a department, or a role -- fans out
// into enrollments for every course in the path (see assignPath's own
// header comment for why this is the role-based training path mechanism).
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const results = await assignPath(
      { orgId, userId: dbUser.id, dbUser },
      id,
      { employeeIds: body.employeeIds, departmentId: body.departmentId, role: body.role },
      body.dueDate
    )
    return NextResponse.json({ results }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training path assign error:", error)
    return NextResponse.json({ error: "Failed to assign training path" }, { status: 500 })
  }
}
