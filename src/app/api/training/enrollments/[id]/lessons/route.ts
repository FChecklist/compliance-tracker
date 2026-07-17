import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLessonProgress, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// Per-lesson progress for a given enrollment -- feeds the course player's
// "which lessons have I finished" view.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ progress: [] })

  try {
    const { id } = await params
    const progress = await listLessonProgress({ orgId }, id)
    return NextResponse.json({ progress })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Lesson progress list error:", error)
    return NextResponse.json({ error: "Failed to fetch lesson progress" }, { status: 500 })
  }
}
