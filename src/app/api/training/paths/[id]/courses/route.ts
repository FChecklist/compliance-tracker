import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { addCourseToPath, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const pathCourse = await addCourseToPath({ orgId, userId: dbUser.id, dbUser }, id, body.courseId, { sortOrder: body.sortOrder, isRequired: body.isRequired })
    return NextResponse.json(pathCourse, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training path add-course error:", error)
    return NextResponse.json({ error: "Failed to add course to training path" }, { status: 500 })
  }
}
