import { NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { predictActivityCompletion, ServiceError } from "@/lib/services/construction-prediction-service"

export async function GET(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { activityId } = await params
    const prediction = await predictActivityCompletion({ orgId: ctx.orgId }, activityId)
    return NextResponse.json(prediction)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction prediction error:", error)
    return NextResponse.json({ error: "Failed to predict completion date" }, { status: 500 })
  }
}
