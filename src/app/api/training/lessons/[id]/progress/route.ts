import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { markLessonProgress, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// Self-service: any authenticated employee can mark their own progress on a
// lesson (start / complete). Auto-enrolls if not already enrolled -- same
// idempotent-upsert posture as hr-attendance-service.ts's checkIn.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const status = body.status || "completed"
    const progress = await markLessonProgress({ orgId, userId: dbUser.id }, id, status)
    return NextResponse.json(progress)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Lesson progress error:", error)
    return NextResponse.json({ error: "Failed to update lesson progress" }, { status: 500 })
  }
}
