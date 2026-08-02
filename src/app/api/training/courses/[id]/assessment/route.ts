import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { createAssessment, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// GET is covered by GET /api/training/courses/[id] (returns the course's
// assessment nested). This route creates the course's assessment.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const assessment = await createAssessment({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(assessment, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training assessment create error:", error)
    return NextResponse.json({ error: "Failed to create assessment" }, { status: 500 })
  }
}
