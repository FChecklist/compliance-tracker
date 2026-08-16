import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { runEval, ServiceError } from "@/lib/services/prompt-eval-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No user found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.promptVersionId) return NextResponse.json({ error: "promptVersionId is required" }, { status: 400 })
    if (!body.provider || !body.model) return NextResponse.json({ error: "provider and model are required" }, { status: 400 })

    const run = await runEval({ userId: dbUser.id, dbUser }, {
      evalCaseId: id, promptVersionId: body.promptVersionId, provider: body.provider, model: body.model,
    })
    return NextResponse.json(run, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt eval run error:", error)
    return NextResponse.json({ error: "Failed to run eval" }, { status: 500 })
  }
}
