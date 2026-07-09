import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { predictTaskCompletion, ServiceError } from "@/lib/services/task-prediction-service"

// Wave 152 (Phase4_Implementation_Plan.md, "Prediction Engine v2") --
// mirrors api/construction/predictions/[activityId]/route.ts's shape
// exactly, same deterministic-prediction pattern applied to a second
// domain.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const prediction = await predictTaskCompletion({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(prediction)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Task prediction error:", error)
    return NextResponse.json({ error: "Failed to predict task completion" }, { status: 500 })
  }
}
