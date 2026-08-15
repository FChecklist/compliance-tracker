import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { updatePipelineStage, deletePipelineStage, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const permissionDenied = requirePermissionForUser(dbUser, "crm.pipeline_stages.manage")
  if (permissionDenied) return permissionDenied

  try {
    const { id } = await params
    const body = await request.json()
    const stage = await updatePipelineStage({ orgId }, id, body)
    return NextResponse.json(stage)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pipeline stage update error:", error)
    return NextResponse.json({ error: "Failed to update pipeline stage" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const permissionDenied = requirePermissionForUser(dbUser, "crm.pipeline_stages.manage")
  if (permissionDenied) return permissionDenied

  try {
    const { id } = await params
    const result = await deletePipelineStage({ orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pipeline stage delete error:", error)
    return NextResponse.json({ error: "Failed to delete pipeline stage" }, { status: 500 })
  }
}
