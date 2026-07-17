import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listEnrollments, selfEnroll, assignCourse, ServiceError, type ProgressStatus } from "@/lib/services/training-service"

// Defaults to "my enrollments" unless a manager explicitly passes employeeId
// for someone else -- matches listAttendance's own filter-driven scoping.
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ enrollments: [] })

  try {
    const params = request.nextUrl.searchParams
    const requestedEmployeeId = params.get("employeeId") || undefined
    let employeeId = dbUser.id
    if (requestedEmployeeId && requestedEmployeeId !== dbUser.id) {
      const roleErr = requireRole(dbUser, "manager")
      if (roleErr) return roleErr
      employeeId = requestedEmployeeId
    }
    const enrollments = await listEnrollments({ orgId }, {
      employeeId, courseId: params.get("courseId") || undefined,
      status: (params.get("status") as ProgressStatus) || undefined,
    })
    return NextResponse.json({ enrollments })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training enrollments list error:", error)
    return NextResponse.json({ error: "Failed to fetch enrollments" }, { status: 500 })
  }
}

// Self-enroll (no employeeId in body) or manager-assign (employeeId set,
// requires manager-or-above) -- same self-vs-manager split as
// hr/attendance's mark route.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.courseId) return NextResponse.json({ error: "courseId is required" }, { status: 400 })

    if (body.employeeId && body.employeeId !== dbUser.id) {
      const roleErr = requireRole(dbUser, "manager")
      if (roleErr) return roleErr
      const enrollment = await assignCourse({ orgId, userId: dbUser.id, dbUser }, body.employeeId, body.courseId, body.dueDate)
      return NextResponse.json(enrollment, { status: 201 })
    }
    const enrollment = await selfEnroll({ orgId, userId: dbUser.id }, body.courseId)
    return NextResponse.json(enrollment, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training enrollment create error:", error)
    return NextResponse.json({ error: "Failed to enroll" }, { status: 500 })
  }
}
