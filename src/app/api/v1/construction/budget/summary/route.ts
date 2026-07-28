import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getBudgetSummary, ServiceError } from "@/lib/services/construction-budget-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ summary: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const summary = await getBudgetSummary({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ summary })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction budget summary error:", error)
    return NextResponse.json({ error: "Failed to build budget summary" }, { status: 500 })
  }
}
