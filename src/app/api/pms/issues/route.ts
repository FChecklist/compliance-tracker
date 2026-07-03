import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listIssues, createIssue } from "@/lib/services/pms-issue-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ issues: [] })

  const params = request.nextUrl.searchParams
  const projectId = params.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const issues = await listIssues({ orgId }, projectId, {
      statusId: params.get("statusId") ?? undefined,
      assigneeId: params.get("assigneeId") ?? undefined,
      priority: params.get("priority") ?? undefined,
      milestoneId: params.get("milestoneId") ?? undefined,
      includeArchived: params.get("includeArchived") === "true",
    })
    return NextResponse.json({ issues })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS issues list error:", error)
    return NextResponse.json({ error: "Failed to fetch issues" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const body = await request.json()
    const result = await createIssue({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS issue create error:", error)
    return NextResponse.json({ error: "Failed to create issue" }, { status: 500 })
  }
}
