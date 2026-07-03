import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listTimeEntriesForIssue, listTimeEntriesForProject, logTime } from "@/lib/services/pms-time-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ timeEntries: [] })

  const params = request.nextUrl.searchParams
  const issueId = params.get("issueId")
  const projectId = params.get("projectId")
  if (!issueId && !projectId) return NextResponse.json({ error: "issueId or projectId query param is required" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const timeEntries = issueId
      ? await listTimeEntriesForIssue({ orgId }, issueId)
      : await listTimeEntriesForProject({ orgId }, projectId!)
    return NextResponse.json({ timeEntries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS time-entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch time entries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const body = await request.json()
    const result = await logTime({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS time-entry create error:", error)
    return NextResponse.json({ error: "Failed to log time" }, { status: 500 })
  }
}
