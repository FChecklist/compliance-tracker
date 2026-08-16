import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listMilestones, createMilestone } from "@/lib/services/pms-taxonomy-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ milestones: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const milestones = await listMilestones({ orgId }, projectId)
    return NextResponse.json({ milestones })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS milestones list error:", error)
    return NextResponse.json({ error: "Failed to fetch milestones" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const result = await createMilestone({ orgId, userId: dbUser.id, dbUser }, body.projectId, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS milestone create error:", error)
    return NextResponse.json({ error: "Failed to create milestone" }, { status: 500 })
  }
}
