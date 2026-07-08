import { NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getProjectDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { projectId } = await params
    const dashboard = await getProjectDashboard({ orgId: ctx.orgId }, projectId)
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch project dashboard" }, { status: 500 })
  }
}
