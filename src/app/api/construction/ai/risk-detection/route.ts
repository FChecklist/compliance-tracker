import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { detectBudgetScheduleRisk, ServiceError } from "@/lib/services/construction-ai-service"

export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const risk = await detectBudgetScheduleRisk({ orgId, userId: dbUser.id }, projectId)
    return NextResponse.json(risk)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction AI risk detection error:", error)
    return NextResponse.json({ error: "Failed to detect budget/schedule risk" }, { status: 500 })
  }
}
