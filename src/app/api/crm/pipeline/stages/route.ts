import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { listPipelineStages, createPipelineStage, ServiceError } from "@/lib/services/crm-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ stages: [] })

  const entityType = request.nextUrl.searchParams.get("entityType") === "lead" ? "lead" : "opportunity"
  try {
    const stages = await listPipelineStages({ orgId }, entityType)
    return NextResponse.json({ stages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pipeline stages list error:", error)
    return NextResponse.json({ error: "Failed to fetch pipeline stages" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const permissionDenied = requirePermissionForUser(dbUser, "crm.pipeline_stages.manage")
  if (permissionDenied) return permissionDenied

  try {
    const body = await request.json()
    const stage = await createPipelineStage({ orgId }, body)
    return NextResponse.json(stage, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pipeline stage create error:", error)
    return NextResponse.json({ error: "Failed to create pipeline stage" }, { status: 500 })
  }
}
