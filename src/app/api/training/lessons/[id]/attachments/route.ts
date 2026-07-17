import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listLessonAttachments, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// Uploading a new attachment reuses the EXISTING POST /api/documents
// endpoint directly from the UI (with linkedEntityType=training_lesson,
// linkedEntityId=<lessonId>) -- deliberately no duplicate upload path here,
// per the task's own instruction to reuse the existing document-attachment
// pattern. This route is read-only: list what's already attached.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ documents: [] })

  try {
    const { id } = await params
    const docs = await listLessonAttachments({ orgId }, id)
    return NextResponse.json({ documents: docs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training lesson attachments error:", error)
    return NextResponse.json({ error: "Failed to fetch attachments" }, { status: 500 })
  }
}
