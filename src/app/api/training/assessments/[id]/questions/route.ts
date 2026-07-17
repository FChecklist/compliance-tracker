import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listQuestions, createQuestion, ServiceError } from "@/lib/services/training-service"

type RouteContext = { params: Promise<{ id: string }> }

// forLearner=true (default for a plain GET, e.g. a learner about to take
// the quiz) strips correctAnswer from the response. Authoring UIs pass
// ?forAuthoring=true to see the answer key.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ questions: [] })

  try {
    const { id } = await params
    const forAuthoring = request.nextUrl.searchParams.get("forAuthoring") === "true"
    const questions = await listQuestions({ orgId }, id, !forAuthoring)
    return NextResponse.json({ questions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training questions list error:", error)
    return NextResponse.json({ error: "Failed to fetch questions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const question = await createQuestion({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(question, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training question create error:", error)
    return NextResponse.json({ error: "Failed to create question" }, { status: 500 })
  }
}
