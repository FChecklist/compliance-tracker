import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getProjectDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { projectId } = await params
    const dashboard = await getProjectDashboard({ orgId }, projectId)
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction project dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch project dashboard" }, { status: 500 })
  }
}
