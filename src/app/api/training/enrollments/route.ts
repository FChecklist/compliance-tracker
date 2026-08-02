import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole, hasRole } from "@/lib/supabase/auth-guard"
import { listEnrollments, enroll, ServiceError } from "@/lib/services/training-service"

export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ enrollments: [] })

  try {
    const params = request.nextUrl.searchParams
    // A non-manager can only ever see their own enrollments -- explicit
    // employeeId filter is ignored unless the caller is manager+ (matches
    // markAttendance's own self-vs-other gating posture).
    const requestedEmployeeId = params.get("employeeId") || undefined
    const employeeId = requestedEmployeeId && requestedEmployeeId !== dbUser.id
      ? (hasRole(dbUser, "manager") ? requestedEmployeeId : dbUser.id)
      : dbUser.id
    const enrollments = await listEnrollments({ orgId }, {
      employeeId, courseId: params.get("courseId") || undefined, status: params.get("status") || undefined,
    })
    return NextResponse.json({ enrollments })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training enrollments list error:", error)
    return NextResponse.json({ error: "Failed to fetch enrollments" }, { status: 500 })
  }
}

// Self-enroll always allowed; enrolling someone else requires manager+,
// matching markAttendance's own self-vs-other role gate.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const targetEmployeeId = body.employeeId || dbUser.id
    if (targetEmployeeId !== dbUser.id) {
      const roleErr = requireRole(dbUser, "manager")
      if (roleErr) return roleErr
    }
    const enrollment = await enroll({ orgId, userId: dbUser.id, dbUser }, targetEmployeeId, body.courseId, { dueDate: body.dueDate })
    return NextResponse.json(enrollment, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training enrollment create error:", error)
    return NextResponse.json({ error: "Failed to enroll" }, { status: 500 })
  }
}
