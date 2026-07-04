import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listWorkflowDefinitions, createWorkflowDefinition, ServiceError } from "@/lib/services/approval-workflow-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ workflows: [] })

  try {
    const entityType = request.nextUrl.searchParams.get("entityType") || undefined
    const workflows = await listWorkflowDefinitions({ orgId }, entityType)
    return NextResponse.json({ workflows })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workflow definitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch approval workflows" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const workflow = await createWorkflowDefinition({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(workflow, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workflow definition create error:", error)
    return NextResponse.json({ error: "Failed to create approval workflow" }, { status: 500 })
  }
}
