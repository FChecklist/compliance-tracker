import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { assignPath, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// Assigning a path (to an individual, a department, or a role) is always
// manager-gated -- this is the mechanism that fans out real enrollments,
// same trust level as bulkMarkAttendance.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await assignPath({ orgId, userId: dbUser.id, dbUser }, id, {
      employeeId: body.employeeId, departmentId: body.departmentId, role: body.role, dueDate: body.dueDate,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training path assign error:", error)
    return NextResponse.json({ error: "Failed to assign training path" }, { status: 500 })
  }
}
