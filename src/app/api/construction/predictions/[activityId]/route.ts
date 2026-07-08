import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { predictActivityCompletion, ServiceError } from "@/lib/services/construction-prediction-service"

export async function GET(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { activityId } = await params
    const prediction = await predictActivityCompletion({ orgId }, activityId)
    return NextResponse.json(prediction)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction prediction error:", error)
    return NextResponse.json({ error: "Failed to predict completion date" }, { status: 500 })
  }
}
