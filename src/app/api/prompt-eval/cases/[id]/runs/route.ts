import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listEvalRuns, ServiceError } from "@/lib/services/prompt-eval-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAuth()
  if (response) return response

  try {
    const { id } = await params
    const runs = await listEvalRuns(id)
    return NextResponse.json({ runs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Prompt eval runs list error:", error)
    return NextResponse.json({ error: "Failed to fetch eval runs" }, { status: 500 })
  }
}
