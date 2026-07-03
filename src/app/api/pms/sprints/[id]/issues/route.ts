import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listSprintIssues, addIssueToSprint, removeIssueFromSprint } from "@/lib/services/pms-sprint-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ issues: [] })

  try {
    await requirePmsEnabled(orgId)
    const { id } = await params
    const issues = await listSprintIssues({ orgId }, id)
    return NextResponse.json({ issues })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS sprint-issues list error:", error)
    return NextResponse.json({ error: "Failed to fetch sprint issues" }, { status: 500 })
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
    if (!body.issueId) return NextResponse.json({ error: "issueId is required" }, { status: 400 })
    const result = await addIssueToSprint({ orgId }, id, body.issueId)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS sprint-issue add error:", error)
    return NextResponse.json({ error: "Failed to add issue to sprint" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const issueId = request.nextUrl.searchParams.get("issueId")
  if (!issueId) return NextResponse.json({ error: "issueId query param is required" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const { id } = await params
    const result = await removeIssueFromSprint({ orgId }, id, issueId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS sprint-issue remove error:", error)
    return NextResponse.json({ error: "Failed to remove issue from sprint" }, { status: 500 })
  }
}
