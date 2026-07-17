import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listCourses, createCourse, ServiceError, type CourseStatus } from "@/lib/services/training-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ courses: [] })

  try {
    const params = request.nextUrl.searchParams
    const courses = await listCourses({ orgId }, {
      status: (params.get("status") as CourseStatus) || undefined,
      category: params.get("category") || undefined,
      targetRole: params.get("targetRole") || undefined,
      targetDepartmentId: params.get("targetDepartmentId") || undefined,
      mandatoryOnly: params.get("mandatoryOnly") === "true",
    })
    return NextResponse.json({ courses })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training courses list error:", error)
    return NextResponse.json({ error: "Failed to fetch courses" }, { status: 500 })
  }
}

// Course authoring is manager-or-above -- matches decideLeaveRequest's own role gate.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const course = await createCourse({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(course, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training course create error:", error)
    return NextResponse.json({ error: "Failed to create course" }, { status: 500 })
  }
}
