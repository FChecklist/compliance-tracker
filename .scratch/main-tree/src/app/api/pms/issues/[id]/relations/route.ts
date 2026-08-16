import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listIssueRelations, addIssueRelation } from "@/lib/services/pms-issue-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ relations: [] })

  try {
    await requirePmsEnabled(orgId)
    const { id } = await params
    const relations = await listIssueRelations({ orgId }, id)
    return NextResponse.json({ relations })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS issue-relations list error:", error)
    return NextResponse.json({ error: "Failed to fetch relations" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const { id } = await params
    const body = await request.json()
    const result = await addIssueRelation({ orgId }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS issue-relation create error:", error)
    return NextResponse.json({ error: "Failed to create relation" }, { status: 500 })
  }
}
