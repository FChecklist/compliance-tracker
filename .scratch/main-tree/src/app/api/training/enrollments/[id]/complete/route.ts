import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { markCourseComplete, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// Manual completion -- only for a course with no assessment (see
// training-service.ts's markCourseComplete for why); a course with an
// assessment completes via POST .../attempts passing instead.
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const enrollment = await markCourseComplete({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(enrollment)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training enrollment complete error:", error)
    return NextResponse.json({ error: "Failed to mark course complete" }, { status: 500 })
  }
}
