import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listWorkflowTransitions, createWorkflowTransition } from "@/lib/services/pms-taxonomy-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ workflowTransitions: [] })

  const issueTypeId = request.nextUrl.searchParams.get("issueTypeId") ?? undefined

  try {
    await requirePmsEnabled(orgId)
    const workflowTransitions = await listWorkflowTransitions({ orgId }, issueTypeId)
    return NextResponse.json({ workflowTransitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS workflow-transitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch workflow transitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const body = await request.json()
    const result = await createWorkflowTransition({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS workflow-transition create error:", error)
    return NextResponse.json({ error: "Failed to create workflow transition" }, { status: 500 })
  }
}
